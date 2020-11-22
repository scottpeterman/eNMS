/*
global
action: false
page: false
serviceTypes: false
theme: false
vis: false
*/

import {
  loadServiceTypes,
  normalRun,
  runLogic,
  showRuntimePanel,
} from "./automation.js";
import {
  call,
  configureNamespace,
  copyToClipboard,
  notify,
  openPanel,
  showInstancePanel,
  userIsActive,
} from "./base.js";
import { clearSearch, tableInstances } from "./table.js";

export let arrowHistory = [""];
export let arrowPointer = page == "workflow_builder" ? -1 : 0;
export let currentPath = localStorage.getItem("path");
export let workflow = JSON.parse(localStorage.getItem("workflow"));
export let currentRuntime;

const container = document.getElementById("network");
const options = {
  interaction: {
    hover: true,
    hoverConnectedEdges: false,
    multiselect: true,
  },
  manipulation: {
    enabled: false,
    addNode: function (data, callback) {},
    addEdge: function (data, callback) {
      if (data.to == "Start") {
        notify("You cannot draw an edge to 'Start'.", "error", 5);
      } else if (data.from == "End") {
        notify("You cannot draw an edge from 'End'.", "error", 5);
      } else if (data.from != data.to) {
        data.subtype = currentMode;
        saveEdge(data);
      }
    },
    deleteNode: function (data, callback) {
      data.nodes = data.nodes.filter((node) => !ends.has(node));
      callback(data);
    },
  },
  ...theme.workflow,
};

let nodes;
let edges;
let graph;
let selectedObject;
let ends = new Set();
let currentMode = "motion";
export let creationMode;
let mousePosition;
let currLabel;
let triggerMenu;
let currentPlaceholder;
let placeholder;

export function displayWorkflow(workflowData) {
  workflow = workflowData.service;
  placeholder = null;
  currentPlaceholder = workflowData.state?.[currentPath]?.placeholder;
  nodes = new vis.DataSet(workflow.services.map(serviceToNode));
  edges = new vis.DataSet(workflow.edges.map(edgeToEdge));
  workflow.services.map(drawIterationEdge);
  for (const [id, label] of Object.entries(workflow.labels)) {
    drawLabel(id, label);
  }
  graph = new vis.Network(container, { nodes: nodes, edges: edges }, options);
  graph.setOptions({ physics: false });
  graph.on("oncontext", function (properties) {
    if (triggerMenu) {
      // eslint-disable-next-line new-cap
      mousePosition = graph.DOMtoCanvas({
        x: properties.event.offsetX,
        y: properties.event.offsetY,
      });
      properties.event.preventDefault();
      const node = this.getNodeAt(properties.pointer.DOM);
      const edge = this.getEdgeAt(properties.pointer.DOM);
      if (typeof node !== "undefined" && !ends.has(node)) {
        graph.selectNodes([node]);
        $(".menu-entry ").hide();
        $(`.${node.length == 36 ? "label" : "node"}-selection`).show();
        selectedObject = nodes.get(node);
        $(".workflow-selection").toggle(selectedObject.type == "workflow");
      } else if (typeof edge !== "undefined" && !ends.has(node)) {
        graph.selectEdges([edge]);
        $(".menu-entry ").hide();
        $(".edge-selection").show();
        selectedObject = edges.get(edge);
      } else {
        $(".menu-entry ").hide();
        $(".global").show();
      }
    } else {
      properties.event.stopPropagation();
      properties.event.preventDefault();
    }
  });
  graph.on("doubleClick", function (event) {
    event.event.preventDefault();
    let node = nodes.get(this.getNodeAt(event.pointer.DOM));
    if (["Placeholder", "Start", "End"].includes(node.name)) node = currentPlaceholder;
    if (!node || !node.id) {
      return;
    } else if (node.type == "label") {
      editLabel(node);
    } else if (node.type == "workflow") {
      switchToWorkflow(`${currentPath}>${node.id}`, null, $("#current-runtime").val());
    } else {
      showInstancePanel(node.type, node.id);
    }
  });
  for (const objectType of ["Node", "Edge"]) {
    graph.on(`hover${objectType}`, function () {
      graph.canvas.body.container.style.cursor = "pointer";
    });
    graph.on(`blur${objectType}`, function () {
      graph.canvas.body.container.style.cursor = "default";
    });
  }
  if (!$(`#current-workflow option[value='${workflow.id}']`).length) {
    $("#current-workflow").append(
      `<option value="${workflow.id}">${workflow.scoped_name}</option>`
    );
  }
  $("#current-workflow").val(workflow.id).selectpicker("refresh");
  graph.on("dragEnd", (event) => {
    if (graph.getNodeAt(event.pointer.DOM)) savePositions();
  });
  displayWorkflowState(workflowData);
  rectangleSelection($("#network"), graph, nodes);
  switchMode(currentMode, true);
}

function updateRuntimes(result) {
  currentPlaceholder = result.state?.[currentPath]?.placeholder;
  const currentRuntime = $("#current-runtime").val();
  $("#current-runtime").empty();
  $("#current-runtime").append("<option value='normal'>Normal Display</option>");
  $("#current-runtime").append("<option value='latest'>Latest Runtime</option>");
  result.runtimes.forEach((r) => {
    $("#current-runtime").append(`<option value='${r[0]}'>${r[0]}</option>`);
  });
  if (placeholder && currentPlaceholder) {
    nodes.update({
      id: placeholder.id,
      label: getServiceLabel(placeholder),
    });
  }
  $("#current-runtime").val(currentRuntime || "latest");
  $("#current-runtime").selectpicker("refresh");
}

const rectangleSelection = (container, network, nodes) => {
  const offsetLeft = container.position().left - container.offset().left;
  const offsetTop = container.position().top - container.offset().top;
  let drag = false;
  let DOMRect = {};

  const canvasify = (DOMx, DOMy) => {
    // eslint-disable-next-line new-cap
    const { x, y } = network.DOMtoCanvas({ x: DOMx, y: DOMy });
    return [x, y];
  };

  const correctRange = (start, end) => (start < end ? [start, end] : [end, start]);

  const selectFromDOMRect = () => {
    const [sX, sY] = canvasify(DOMRect.startX, DOMRect.startY);
    const [eX, eY] = canvasify(DOMRect.endX, DOMRect.endY);
    const [startX, endX] = correctRange(sX, eX);
    const [startY, endY] = correctRange(sY, eY);
    triggerMenu = startX == endX && startY == endY;
    if (triggerMenu) return;
    network.selectNodes(
      nodes.get().reduce((selected, { id }) => {
        const { x, y } = network.getPositions(id)[id];
        return startX <= x && x <= endX && startY <= y && y <= endY
          ? selected.concat(id)
          : selected;
      }, [])
    );
  };

  container.on("mousedown", function ({ which, pageX, pageY }) {
    if (which === 3) {
      Object.assign(DOMRect, {
        startX: pageX - this.offsetLeft + offsetLeft,
        startY: pageY - this.offsetTop + offsetTop,
        endX: pageX - this.offsetLeft + offsetLeft,
        endY: pageY - this.offsetTop + offsetTop,
      });
      drag = true;
    }
  });

  container.on("mousemove", function ({ which, pageX, pageY }) {
    if (which === 0 && drag) {
      drag = false;
      network.redraw();
    } else if (drag) {
      Object.assign(DOMRect, {
        endX: pageX - this.offsetLeft + offsetLeft,
        endY: pageY - this.offsetTop + offsetTop,
      });
      network.redraw();
    }
  });

  container.on("mouseup", function ({ which }) {
    if (which === 3) {
      drag = false;
      network.redraw();
      selectFromDOMRect();
    }
  });

  network.on("afterDrawing", (context) => {
    if (drag) {
      const [startX, startY] = canvasify(DOMRect.startX, DOMRect.startY);
      const [endX, endY] = canvasify(DOMRect.endX, DOMRect.endY);
      context.setLineDash([5]);
      context.strokeStyle = "rgba(78, 146, 237, 0.75)";
      context.strokeRect(startX, startY, endX - startX, endY - startY);
      context.setLineDash([]);
      context.fillStyle = "rgba(151, 194, 252, 0.45)";
      context.fillRect(startX, startY, endX - startX, endY - startY);
    }
  });
};

function filterWorkflowTable(tableId, path) {
  clearSearch(tableId);
  switchToWorkflow(path);
}

export const switchToWorkflow = function (path, arrow, runtime, selection) {
  if (typeof path === "undefined") return;
  if (path.toString().includes(">")) {
    $("#up-arrow").removeClass("disabled");
  } else {
    $("#up-arrow").addClass("disabled");
  }
  currentPath = path;
  if (!arrow) {
    arrowPointer++;
    arrowHistory.splice(arrowPointer, 9e9, path);
  } else {
    arrowPointer += arrow == "right" ? 1 : -1;
  }
  if (arrowHistory.length >= 1 && arrowPointer !== 0) {
    $("#left-arrow").removeClass("disabled");
  } else {
    $("#left-arrow").addClass("disabled");
  }
  if (arrowPointer < arrowHistory.length - 1) {
    $("#right-arrow").removeClass("disabled");
  } else {
    $("#right-arrow").addClass("disabled");
  }
  if (page == "workflow_builder") {
    call({
      url: `/get_service_state/${path}/${runtime || "latest"}`,
      callback: function (result) {
        workflow = result.service;
        if (workflow?.superworkflow) {
          if (!currentPath.includes(workflow.superworkflow.id)) {
            currentPath = `${workflow.superworkflow.id}>${path}`;
          }
          $("#up-arrow").removeClass("disabled");
        }
        localStorage.setItem("path", path);
        if (workflow) {
          localStorage.setItem("workflow", JSON.stringify(workflow));
        }
        displayWorkflow(result);
        if (selection) graph.setSelection(selection);
      },
    });
  } else {
    $("#workflow-filtering").val(path);
    tableInstances["service"].table.page(0).ajax.reload(null, false);
  }
};

export function processWorkflowData(instance, id) {
  if (["create_workflow", "duplicate_workflow"].includes(creationMode)) {
    $("#current-workflow").append(
      `<option value="${instance.id}">${instance.name}</option>`
    );
    $("#current-workflow").val(instance.id).trigger("change");
    creationMode = null;
    switchToWorkflow(instance.id);
  } else if (!instance.type) {
    edges.update(edgeToEdge(instance));
  } else if (instance.type.includes("service") || instance.type == "workflow") {
    if (id) {
      if (workflow.id == id) return;
      nodes.update(serviceToNode(instance));
      let serviceIndex = workflow.services.findIndex((s) => s.id == instance.id);
      workflow.services[serviceIndex] = instance;
    } else {
      call({
        url: `/add_service_to_workflow/${workflow.id}/${instance.id}`,
        callback: function () {
          updateWorkflowService(instance);
        },
      });
    }
    drawIterationEdge(instance);
  }
}

function updateWorkflowService(service) {
  nodes.add(serviceToNode(service));
  workflow.services.push(service);
  switchMode("motion", true);
  notify(`Service '${service.scoped_name}' added to the workflow.`, "success", 5);
}

function addServicesToWorkflow() {
  const selection = $("#service-tree").jstree("get_checked", true);
  if (!selection.length) notify("Nothing selected.", "error", 5);
  $("#services").val(selection.map((n) => n.data.id));
  call({
    url: `/copy_service_in_workflow/${workflow.id}`,
    form: "add-services-form",
    callback: function (result) {
      workflow.last_modified = result.update_time;
      $("#add_services_to_workflow").remove();
      result.services.map(updateWorkflowService);
    },
  });
}

function deleteSelection() {
  const selection = {
    nodes: graph.getSelectedNodes().filter((node) => !ends.has(node)),
    edges: graph.getSelectedEdges(),
  };
  selection.nodes.forEach((node) => {
    delete workflow.labels[node];
    graph.getConnectedEdges(node).forEach((edge) => {
      if (!selection.edges.includes(edge)) selection.edges.push(edge);
    });
  });
  call({
    url: `/delete_workflow_selection/${workflow.id}`,
    data: selection,
    callback: function (updateTime) {
      graph.deleteSelected();
      workflow.services = workflow.services.filter(
        (n) => !selection.nodes.includes(n.id)
      );
      workflow.edges = workflow.edges.filter((e) => !selection.edges.includes(e.id));
      workflow.last_modified = updateTime;
      notify("Selection removed.", "success", 5);
      switchMode(currentMode, true);
    },
  });
}

function saveEdge(edge) {
  const param = `${workflow.id}/${edge.subtype}/${edge.from}/${edge.to}`;
  call({
    url: `/add_edge/${param}`,
    callback: function (result) {
      workflow.last_modified = result.update_time;
      const newEdge = edgeToEdge(result.edge);
      edges.add(newEdge);
      workflow.edges.push(newEdge);
      graph.addEdgeMode();
    },
  });
}

function stopWorkflow() {
  call({
    url: `/stop_workflow/${currentRuntime}`,
    callback: (result) => {
      if (!result) {
        notify("The workflow is not currently running.", "error", 5);
      } else {
        notify("Workflow will stop after current service...", "success", 5);
      }
    },
  });
}

function skipServices() {
  const selectedNodes = graph.getSelectedNodes().filter((x) => !isNaN(x));
  if (!selectedNodes.length) return;
  call({
    url: `/skip_services/${workflow.id}/${selectedNodes.join("-")}`,
    callback: (result) => {
      workflow.last_modified = result.update_time;
      workflow.services.forEach((service) => {
        if (selectedNodes.includes(service.id)) {
          service.skip[workflow.name] = result.skip === "skip";
          nodes.update({
            id: service.id,
            color: result.skip === "skip" ? "#D3D3D3" : "#D2E5FF",
          });
        }
      });
      notify(`Services ${result.skip}ped.`, "success", 5);
    },
  });
}

function getServiceLabel(service) {
  if (["Start", "End"].includes(service.scoped_name)) {
    return service.scoped_name;
  }
  let label =
    service.type == "workflow"
      ? `\n     ${service.scoped_name}     \n`
      : `${service.scoped_name}\n`;
  label += "—————\n";
  if (service.scoped_name == "Placeholder" && currentPlaceholder) {
    label += currentPlaceholder.scoped_name;
  } else {
    label += service.type == "workflow" ? "Subworkflow" : serviceTypes[service.type];
  }
  return label;
}

function serviceToNode(service) {
  const isPlaceholder = service.scoped_name == "Placeholder";
  if (isPlaceholder) placeholder = service;
  const defaultService = ["Start", "End"].includes(service.scoped_name);
  if (defaultService) ends.add(service.id);
  return {
    id: service.id,
    shape: service.type == "workflow" ? "ellipse" : defaultService ? "circle" : "box",
    color: defaultService ? "pink" : isPlaceholder ? "#E6ADD8" : "#D2E5FF",
    font: {
      size: 15,
      multi: "html",
      align: "center",
      bold: { color: "#000000" },
    },
    shadow: {
      enabled: !defaultService && !isPlaceholder,
      color: service.shared ? "#FF1694" : "#6666FF",
      size: 15,
    },
    label: getServiceLabel(service),
    name: service.scoped_name,
    type: service.type,
    x: service.positions[workflow.name] ? service.positions[workflow.name][0] : 0,
    y: service.positions[workflow.name] ? service.positions[workflow.name][1] : 0,
  };
}

function drawLabel(id, label) {
  nodes.update({
    id: id,
    shape: "box",
    type: "label",
    font: { align: label.alignment || "center" },
    label: label.content,
    borderWidth: 0,
    color: "#FFFFFF",
    x: label.positions[0],
    y: label.positions[1],
  });
}

function drawIterationEdge(service) {
  if (!service.iteration_values && !service.iteration_devices) {
    edges.remove(-service.id);
  } else if (!edges.get(-service.id)) {
    let title = "";
    if (service.iteration_devices) {
      title += `<b>Iteration Devices</b>: ${service.iteration_devices}<br>`;
    }
    if (service.iteration_values) {
      title += `<b>Iteration Values</b>: ${service.iteration_values}<br>`;
    }
    title += `<b>Iteration Variable Name</b>: ${service.iteration_variable_name}`;
    {
      edges.add({
        id: -service.id,
        label: "Iteration",
        from: service.id,
        to: service.id,
        color: "black",
        arrows: { to: { enabled: true } },
        title: title,
        font: { vadjust: -15 },
      });
    }
  }
}

function edgeToEdge(edge) {
  return {
    id: edge.id,
    label: edge.label,
    type: edge.subtype,
    from: edge.source_id,
    to: edge.destination_id,
    smooth: {
      type: "curvedCW",
      roundness: edge.subtype == "success" ? 0.1 : edge.subtype == "failure" ? -0.1 : 0,
    },
    color: {
      color: edge.color,
    },
    arrows: { to: { enabled: true } },
  };
}

function switchMode(mode, noNotification) {
  const oldMode = currentMode;
  currentMode = mode || (currentMode == "motion" ? $("#edge-type").val() : "motion");
  if ((oldMode == "motion" || currentMode == "motion") && oldMode != currentMode) {
    $("#mode-icon").toggleClass("glyphicon-move").toggleClass("glyphicon-random");
  }
  let notification;
  if (currentMode == "motion") {
    graph.addNodeMode();
    notification = "Mode: Motion.";
  } else {
    graph.setSelection({ nodes: [], edges: [] });
    graph.addEdgeMode();
    notification = `Mode: Creation of '${currentMode}' Edge.`;
  }
  if (!noNotification) notify(notification, "success", 5);
}

$("#current-workflow").on("change", function () {
  if (!workflow || this.value != workflow.id) switchToWorkflow(this.value);
});

$("#current-runtime").on("change", function () {
  getWorkflowState();
});

function savePositions() {
  call({
    url: `/save_positions/${workflow.id}`,
    data: graph.getPositions(),
    callback: function (updateTime) {
      if (updateTime) workflow.last_modified = updateTime;
    },
  });
}

function addServicePanel() {
  openPanel({
    name: "add_services_to_workflow",
    callback: function () {
      $("#service-tree").jstree({
        core: {
          animation: 200,
          themes: { stripes: true },
          data: {
            url: function (node) {
              const nodeId = node.id == "#" ? "all" : node.data.id;
              return `/get_workflow_services/${workflow.id}/${nodeId}`;
            },
            type: "POST",
          },
        },
        plugins: ["checkbox", "search", "types", "wholerow"],
        checkbox: {
          three_state: false,
        },
        search: {
          show_only_matches: true,
          ajax: {
            type: "POST",
            url: "/search_workflow_services",
          },
        },
        types: {
          category: {
            icon: "fa fa-folder",
          },
          default: {
            icon: "glyphicon glyphicon-file",
          },
          workflow: {
            icon: "fa fa-sitemap",
          },
        },
      });
      let timer = false;
      $("#add-services-search").keyup(function (event) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          $("#service-tree").jstree(true).search($("#add-services-search").val());
        }, 500);
      });
    },
  });
}

function createNew(mode) {
  creationMode = mode;
  if (mode == "create_workflow") {
    showInstancePanel("workflow");
  } else if (mode == "duplicate_workflow") {
    showInstancePanel("workflow", workflow.id, "duplicate");
  } else {
    showInstancePanel($("#service-type").val());
  }
}

function getResultLink(service, device) {
  const link = `get_result("${service.name}"${device ? ", device=device.name" : ""})`;
  copyToClipboard(link);
}

Object.assign(action, {
  "Run Workflow": () => runWorkflow(),
  "Parameterized Workflow Run": () => runWorkflow(true),
  "Create Workflow": () => createNew("create_workflow"),
  "Duplicate Workflow": () => createNew("duplicate_workflow"),
  "Create New Service": () => createNew("create_service"),
  "Edit Workflow": () => showInstancePanel("workflow", workflow.id),
  "Restart Workflow from Here": (service) =>
    showRestartWorkflowPanel(workflow, service),
  "Workflow Results Tree": () => showRuntimePanel("results", workflow),
  "Workflow Results Table": () =>
    showRuntimePanel("results", workflow, null, "full_result"),
  "Workflow Logs": () => showRuntimePanel("logs", workflow),
  "Add to Workflow": addServicePanel,
  "Stop Workflow": () => stopWorkflow(),
  Delete: deleteSelection,
  "Service Name": (service) => copyToClipboard(service.name),
  "Top-level Result": getResultLink,
  "Per-device Result": (node) => getResultLink(node, true),
  "Create 'Success' edge": () => switchMode("success"),
  "Create 'Failure' edge": () => switchMode("failure"),
  "Create 'Prerequisite' edge": () => switchMode("prerequisite"),
  "Move Nodes": () => switchMode("motion"),
  "Create Label": () =>
    openPanel({ name: "workflow_label", title: "Create a new label" }),
  "Edit Label": editLabel,
  "Edit Edge": (edge) => {
    showInstancePanel("workflow_edge", edge.id);
  },
  Skip: () => skipServices(),
  "Zoom In": () => graph.zoom(0.2),
  "Zoom Out": () => graph.zoom(-0.2),
  "Enter Workflow": (node) => switchToWorkflow(`${currentPath}>${node.id}`),
  Backward: () => switchToWorkflow(arrowHistory[arrowPointer - 1], "left"),
  Forward: () => switchToWorkflow(arrowHistory[arrowPointer + 1], "right"),
  Upward: () => {
    const parentPath = currentPath.split(">").slice(0, -1).join(">");
    if (parentPath) switchToWorkflow(parentPath);
  },
});

function createLabel() {
  const pos = currLabel
    ? [currLabel.x, currLabel.y]
    : mousePosition
    ? [mousePosition.x, mousePosition.y]
    : [0, 0];
  call({
    url: `/create_label/${workflow.id}/${pos[0]}/${pos[1]}/${currLabel?.id}`,
    form: "workflow_label-form",
    callback: function (result) {
      drawLabel(result.id, result);
      $("#workflow_label").remove();
      notify("Label created.", "success", 5);
    },
  });
}

function editLabel(label) {
  openPanel({
    name: "workflow_label",
    title: "Edit label",
    callback: () => {
      $("#workflow_label-text").val(label.label);
      $("#workflow_label-alignment").val(label.font.align).selectpicker("refresh");
      currLabel = label;
    },
  });
}

function runWorkflow(withUpdates) {
  resetDisplay();
  if (withUpdates) {
    showInstancePanel("workflow", workflow.id, "run");
  } else {
    normalRun(workflow.id);
  }
}

function showRestartWorkflowPanel(workflow, service) {
  openPanel({
    name: "restart_workflow",
    title: `Restart Workflow '${workflow.name}' from '${service.name}'`,
    id: workflow.id,
    callback: function () {
      $("#start_services").append(new Option(service.name, service.id));
      $("#start_services").val(service.id).trigger("change");
      call({
        url: `/get_runtimes/service/${workflow.id}`,
        callback: function (runtimes) {
          runtimes.forEach((runtime) => {
            $("#restart_runtime").append(
              $("<option></option>").attr("value", runtime[0]).text(runtime[1])
            );
          });
          $("#restart_runtime").val(runtimes[runtimes.length - 1]);
          $("#restart_runtime").selectpicker("refresh");
        },
      });
    },
  });
}

function restartWorkflow() {
  call({
    url: `/run_service/${currentPath}`,
    form: `restart_workflow-form`,
    callback: function (result) {
      $(`#restart_workflow-${workflow.id}`).remove();
      runLogic(result);
    },
  });
}

function colorService(id, color) {
  if (!ends.has(id) && nodes) {
    nodes.update({ id: id, color: color });
  }
}

export function getServiceState(id, first) {
  call({
    url: `/get_service_state/${id}`,
    callback: function (result) {
      if (first || result.state.status == "Running") {
        colorService(id, "#89CFF0");
        if (result.service && result.service.type === "workflow") {
          localStorage.setItem("path", id);
          localStorage.setItem("workflow", JSON.stringify(result.service));
        }
        setTimeout(() => getServiceState(id), 300);
      } else {
        colorService(id, "#D2E5FF");
      }
    },
  });
}

function displayWorkflowState(result) {
  resetDisplay();
  updateRuntimes(result);
  if (currentRuntime == "normal") return;
  if (!nodes || !edges || !result.state) return;
  let nodeUpdates = [];
  let edgeUpdates = [];
  const serviceIds = workflow.services.map((s) => s.id);
  for (let [path, state] of Object.entries(result.state)) {
    const id = parseInt(path.split(">").slice(-1)[0]);
    if (ends.has(id) || !serviceIds.includes(id)) continue;
    if (state.progress?.device) {
      const total = parseInt(state.progress?.device?.total) || 0;
      const success = parseInt(state.progress?.device?.success) || 0;
      const skipped = parseInt(state.progress?.device?.skipped) || 0;
      const failure = parseInt(state.progress?.device?.failure) || 0;
      colorService(
        id,
        state.status == "Skipped" || (total && skipped == total)
          ? "#D3D3D3"
          : success + failure + skipped < total
          ? "#89CFF0"
          : state.success === true
          ? "#32cd32"
          : state.success === false
          ? "#FF6666"
          : "#00CCFF"
      );
      if (total) {
        let label = `<b>${nodes.get(id).name}</b>\n`;
        let progressLabel = `Progress - ${success + failure + skipped}/${total}`;
        label += `—————\n${progressLabel}`;
        let progressInfo = [];
        if (success) progressInfo.push(`${success} passed`);
        if (failure) progressInfo.push(`${failure} failed`);
        if (skipped) progressInfo.push(`${skipped} skipped`);
        if (progressInfo.length) label += ` (${progressInfo.join(", ")})`;
        nodeUpdates.push({
          id: id,
          label: label,
        });
      }
    } else {
      colorService(id, state.success ? "#32cd32" : "#FF6666");
    }
  }
  nodes.update(nodeUpdates);
  const state = result.state[currentPath];
  if (state?.edges) {
    for (let [id, devices] of Object.entries(state.edges)) {
      if (!edges.get(parseInt(id))) continue;
      edgeUpdates.push({
        id: parseInt(id),
        label: isNaN(devices)
          ? `<b>${devices}</b>`
          : `<b>${devices} DEVICE${devices == 1 ? "" : "S"}</b>`,
        font: { size: 15, multi: "html" },
      });
    }
    edges.update(edgeUpdates);
  }
}

function resetDisplay() {
  let nodeUpdates = [];
  let edgeUpdates = [];
  $("#progressbar").hide();
  workflow.services.forEach((service) => {
    if (service.scoped_name == "Placeholder") {
      nodeUpdates.push({
        id: service.id,
        label: "Placeholder",
      });
    } else if (ends.has(service.id) || !nodes) {
      return;
    } else {
      nodeUpdates.push({
        id: service.id,
        label: getServiceLabel(service),
        color: service.skip[workflow.name] ? "#D3D3D3" : "#D2E5FF",
      });
    }
  });
  if (nodes) nodes.update(nodeUpdates);
  if (edges) {
    workflow.edges.forEach((edge) => {
      edgeUpdates.push({ id: edge.id, label: edge.label });
    });
    edges.update(edgeUpdates);
  }
}

function getWorkflowState(periodic) {
  const runtime = $("#current-runtime").val();
  const url = runtime ? `/${runtime}` : "";
  if (userIsActive && workflow?.id) {
    call({
      url: `/get_service_state/${currentPath}${url}`,
      callback: function (result) {
        if (!Object.keys(result).length || result.service.id != workflow.id) return;
        currentRuntime = result.runtime;
        if (result.service.last_modified !== workflow.last_modified) {
          displayWorkflow(result);
        } else {
          displayWorkflowState(result);
        }
      },
    });
  }
  if (periodic) setTimeout(() => getWorkflowState(true), 4000);
}

function getWorkflowTree() {
  openPanel({
    title: `${workflow.scoped_name} - Tree Structure`,
    content: `
      <div class="modal-body">
        <input
          type="text"
          class="form-control"
          id="tree-search-${workflow.id}"
          placeholder="Search"
        >
        <hr />
        <div id="workflow-tree-${workflow.id}"></div>
        <input type="hidden" name="services" id="services" />
      </div>`,
    callback: function () {
      call({
        url: `/get_workflow_tree/${currentPath}`,
        callback: function (data) {
          $(`#workflow-tree-${workflow.id}`).jstree({
            core: {
              animation: 100,
              themes: { stripes: true },
              data: data,
            },
            plugins: ["html_row", "search", "types", "wholerow"],
            html_row: {
              default: function (el, node) {
                if (!node) return;
                const service = JSON.stringify(node.data);
                $(el).find("a").first().append(`
                  <div style="position: absolute; top: 0px; right: 20px">
                    <button
                      type="button"
                      class="btn btn-xs btn-info"
                      onclick='eNMS.workflow.highlightService(${service})'
                    >
                      <span class="glyphicon glyphicon-screenshot"></span>
                    </button>
                    <button
                      type="button"
                      class="btn btn-xs btn-primary"
                      onclick='eNMS.base.showInstancePanel("service", ${node.data.id})'
                    >
                      <span class="glyphicon glyphicon-edit"></span>
                    </button>
                  </div>
                `);
              },
            },
            search: {
              show_only_matches: true,
            },
            types: {
              default: {
                icon: "glyphicon glyphicon-file",
              },
              workflow: {
                icon: "fa fa-sitemap",
              },
            },
          });
          let timer = false;
          $(`#tree-search-${workflow.id}`).keyup(function () {
            if (timer) clearTimeout(timer);
            timer = setTimeout(function () {
              const searchValue = $(`#tree-search-${workflow.id}`).val();
              $(`#workflow-tree-${workflow.id}`).jstree(true).search(searchValue);
            }, 500);
          });
        },
      });
    },
  });
}

function highlightService(service) {
  const servicePath = service.path.split(">");
  const [workflowId, serviceId] = servicePath.slice(-2);
  const selection = { nodes: [parseInt(serviceId)], edges: [] };
  if (workflowId != workflow.id) {
    const workflowPath = servicePath.slice(0, -1).join(">");
    switchToWorkflow(workflowPath, null, currentRuntime, selection);
  } else if (serviceId) {
    graph.setSelection(selection);
  }
}

export function initWorkflowBuilder() {
  vis.Network.prototype.zoom = function (scale) {
    const animationOptions = {
      scale: this.getScale() + scale,
      animation: { duration: 300 },
    };
    this.view.moveTo(animationOptions);
  };
  loadServiceTypes();
  $("#left-arrow,#right-arrow").addClass("disabled");
  $("#edge-type").on("change", function () {
    switchMode(this.value);
  });
  call({
    url: "/get_top_level_workflows",
    callback: function (workflows) {
      workflows.sort((a, b) => a.name.localeCompare(b.name));
      for (let i = 0; i < workflows.length; i++) {
        $("#current-workflow").append(
          `<option value="${workflows[i].id}">${workflows[i].name}</option>`
        );
      }
      if (currentPath && workflows.some((w) => w.id == currentPath.split(">")[0])) {
        $("#current-workflow").val(currentPath.split(">")[0]);
        switchToWorkflow(currentPath);
      } else {
        workflow = $("#current-workflow").val();
        if (workflow) {
          switchToWorkflow(workflow);
        } else {
          notify("No workflow has been created yet.", "error", 5);
        }
      }
      $("#current-workflow,#current-runtimes").selectpicker({
        liveSearch: true,
      });
      $("#edge-type").selectpicker();
      getWorkflowState(true);
    },
  });
  $("#network").contextMenu({
    menuSelector: "#contextMenu",
    menuSelected: function (selectedMenu) {
      const row = selectedMenu.text();
      action[row](selectedObject);
    },
  });
}

configureNamespace("workflow", [
  addServicesToWorkflow,
  createLabel,
  highlightService,
  filterWorkflowTable,
  getWorkflowState,
  getWorkflowTree,
  restartWorkflow,
  switchMode,
  switchToWorkflow,
]);
