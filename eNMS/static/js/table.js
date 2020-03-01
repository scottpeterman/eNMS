/*
global
tableProperties: false
*/

import {
  configureNamespace,
  createTooltip,
  createTooltips,
  notify,
  serializeForm,
  userIsActive,
} from "./base.js";
import { loadServiceTypes } from "./automation.js";

export let tables = {};
export let tableInstances = {};
export const models = {};
let waitForSearch = false;

function filterTable(id) {
  tableInstances[id].page(0).ajax.reload(null, false);
  notify("Filter applied.", "success", 5);
}

export const refreshTable = function(id, displayNotification) {
  tableInstances[id].ajax.reload(null, false);
  if (displayNotification) notify("Table refreshed.", "success", 5);
};

function refreshTablePeriodically(id, interval, first) {
  if (userIsActive && !first) refreshTable(id, false);
  setTimeout(() => refreshTablePeriodically(id, interval), interval);
}

export class Table {

  constructor(type, instance, runtime, id) {
    let self = this;
    this.type = type
    let columns = tableProperties[type];
    let visibleColumns = localStorage.getItem(`table/${type}`);
    if (visibleColumns) visibleColumns = visibleColumns.split(",");
    columns.forEach((column) => {
      if (visibleColumns) column.visible = visibleColumns.includes(column.data);
      column.name = column.data;
    });
    this.id = `${type}${id ? `-${id}` : ""}`;
    // eslint-disable-next-line new-cap
    this.table = tableInstances[this.id] = $(`#table-${this.id}`).DataTable({
      serverSide: true,
      orderCellsTop: true,
      autoWidth: false,
      scrollX: true,
      drawCallback: function() {
        $(".paginate_button > a").on("focus", function() {
          $(this).blur();
        });
        createTooltips();
      },
      sDom: "tilp",
      columns: columns,
      columnDefs: [{ className: "dt-center", targets: "_all" }],
      initComplete: function() {
        this.api()
          .columns()
          .every(function(index) {
            const data = columns[index];
            let element;
            const elementId = `${type}_filtering-${data.data}`;
            if (data.search == "text") {
              element = `
              <div class="input-group" style="width:100%">
                <input
                  id="${elementId}"
                  name="${data.data}"
                  type="text"
                  placeholder="&#xF002;"
                  class="form-control search-input"
                  style="font-family:Arial, FontAwesome;
                  height: 30px; margin-top: 5px"
                >
                <span class="input-group-btn" style="width: 10px">
                  <button
                    id="${elementId}-search"
                    class="btn btn-default pull-right"
                    type="button"
                    style="height: 30px; margin-top: 5px">
                      <span
                        class="glyphicon glyphicon-center glyphicon-menu-down"
                        aria-hidden="true"
                        style="font-size: 10px">
                      </span>
                  </button>
                </span>
              </div>`;
            } else if (data.search == "bool") {
              element = `
                <select
                  id="${elementId}"
                  name="${data.data}"
                  class="form-control search-list"
                  style="width: 100%; height: 30px; margin-top: 5px"
                >
                  <option value="">Any</option>
                  <option value="bool-true">True</option>
                  <option value="bool-false">False</option>
                </select>`;
            }
            $(element)
              .appendTo($(this.header()))
              .on("keyup", function() {
                if (waitForSearch) return;
                waitForSearch = true;
                setTimeout(function() {
                  self.table.page(0).ajax.reload(null, false);
                  waitForSearch = false;
                }, 800);
              })
              .on("click", function(e) {
                e.stopPropagation();
              });
          });
        $(`#controls-${self.id}`).html(self.controls);
        self.postProcessing(columns, type);
      },
      ajax: {
        url: `/filtering/${self.modelFiltering || type}`,
        type: "POST",
        contentType: "application/json",
        data: (d) => {
          const form = `#search-form-${this.id}`;
          d.form = serializeForm(form);
          d.instance = instance;
          d.columns = columns;
          d.type = type;
          if (runtime) {
            d.runtime = $(`#runtimes-${instance.id}`).val() || runtime;
          }
          return JSON.stringify(d);
        },
        dataSrc: function(result) {
          return result.data.map(
            (instance) => self.addRow({ properties: instance, tableId: self.id })
          );
        },
      },
    });
    $(window).resize(this.table.columns.adjust);
    if (["changelog", "run", "result"].includes(type)) {
      this.table.order([0, "desc"]).draw();
    }
    if (["run", "service", "task", "workflow"].includes(type)) {
      refreshTablePeriodically(this.id, 3000, true);
    }
  }

  postProcessing(columns, type) {
    let self = this;
    if ($(`#advanced-search-${type}`).length) {
      createTooltip({
        autoshow: true,
        persistent: true,
        name: `${type}_relation_filtering`,
        target: `#advanced-search-${type}`,
        container: `#controls-${type}`,
        position: {
          my: "center-top",
          at: "center-bottom",
          offsetY: 18,
        },
        url: `../form/${type}_relation_filtering`,
        title: "Relationship-based Filtering",
      });
    }
    this.createfilteringTooltips(type, columns);
    createTooltips();
    const visibleColumns = localStorage.getItem(`table/${type}`);
    columns.forEach((column) => {
      const visible = visibleColumns
        ? visibleColumns.split(",").includes(column.name)
        : "visible" in column
        ? column.visible
        : true;
      $("#column-display").append(
        new Option(column.title || column.data, column.data, visible, visible)
      );
    });
    $("#column-display").selectpicker("refresh");
    $("#column-display").on("change", function() {
      columns.forEach((col) => {
        self.table.column(`${col.name}:name`).visible(
          $(this)
            .val()
            .includes(col.data)
        );
      });
      self.table.ajax.reload(null, false);
      self.createfilteringTooltips(type, columns);
      localStorage.setItem(`table/${type}`, $(this).val());
    });
    self.table.columns.adjust();
  }

  createfilteringTooltips(type, columns) {
    columns.forEach((column) => {
      if (column.search != "text") return;
      const elementId = `${type}_filtering-${column.data}`;
      createTooltip({
        persistent: true,
        name: elementId,
        target: `#${elementId}-search`,
        container: `#tooltip-overlay`,
        position: {
          my: "center-top",
          at: "center-bottom",
        },
        content: `
        <div class="modal-body">
          <select
            id="${column.data}_filter"
            name="${column.data}_filter"
            class="form-control search-select"
            style="width: 100%; height: 30px; margin-top: 15px"
          >
            <option value="inclusion">Inclusion</option>
            <option value="equality">Equality</option>
            <option value="regex">Regular Expression</option>
          </select>
        </div>`,
      });
    });
  }

  columnDisplay() {
    return `
      <button
        style="background:transparent; border:none; 
        color:transparent; width: 200px;"
        type="button"
      >
        <select multiple
          id="column-display"
          title="Columns"
          class="form-control"
          data-actions-box="true"
          data-selected-text-format="static"
        ></select>
      </button>`;
  }

  createNewButton() {
    return `
      <button
        class="btn btn-primary"
        onclick="eNMS.base.showTypePanel('${this.type}')"
        data-tooltip="New"
        type="button"
      >
        <span class="glyphicon glyphicon-plus"></span>
      </button>`;
  }

  searchTableButton() {
    return `
      <button
        id="advanced-search-${this.type}"
        class="btn btn-info"
        data-tooltip="Advanced Search"
        type="button"
      >
        <span class="glyphicon glyphicon-search"></span>
      </button>
      <button
        class="btn btn-info"
        onclick="eNMS.table.clearSearch()"
        data-tooltip="Clear Search"
        type="button"
      >
        <span class="glyphicon glyphicon-remove"></span>
      </button>`;
  }

  refreshTableButton() {
    return `
      <button
        class="btn btn-info"
        onclick="eNMS.table.refreshTable('${this.id}', true)"
        data-tooltip="Refresh"
        type="button"
      >
        <span class="glyphicon glyphicon-refresh"></span>
      </button>`;
  }

  deleteInstanceButton(row) {
    return `
      <li>
        <button type="button" class="btn btn-sm btn-danger"
        onclick="eNMS.base.showDeletionPanel(${row.instance})" data-tooltip="Delete"
          ><span class="glyphicon glyphicon-trash"></span
        ></button>
      </li>`;
  }

  addRow({ properties, tableId, derivedProperties }) {
    let row = {tableId: tableId, ...properties};
    row.instanceProperties = {
      id: row.id,
      name: row.dbName || row.name,
      type: row.type,
    };
    if (derivedProperties) {
      derivedProperties.forEach((property) => {
        row.instanceProperties[property] = row[property];
      });
    }
    row.instance = JSON.stringify(row.instanceProperties).replace(/"/g, "'");
    row.buttons = this.buttons(row);
    return row
  }
}

tables.device = class DeviceTable extends Table {
  get controls() {
    return [
      this.columnDisplay(),
      this.createNewButton("device"),
      ` <button type="button" class="btn btn-primary"
      onclick="eNMS.inventory.showImportTopologyPanel()"
      data-tooltip="Import"><span class="glyphicon glyphicon-download">
      </span></button>
      <button type="button" class="btn btn-primary"
        onclick="eNMS.base.openPanel({name: 'excel_export'})"
        data-tooltip="Export"
      >
        <span class="glyphicon glyphicon-upload"></span>
      </button>`,
      this.searchTableButton("device"),
      this.refreshTableButton("device"),
    ];
  }

  buttons(row) {
    return `
      <ul class="pagination pagination-lg" style="margin: 0px; width: 230px">
        <li>
          <button type="button" class="btn btn-sm btn-dark"
          onclick="eNMS.inventory.showConnectionPanel(${row.instance})"
          data-tooltip="Connection"
            ><span class="glyphicon glyphicon-console"></span
          ></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-info"
          onclick="eNMS.inventory.showDeviceData(${row.instance})"
          data-tooltip="Network Data"
            ><span class="glyphicon glyphicon-cog"></span
          ></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-info"
          onclick="eNMS.inventory.showDeviceResultsPanel(${row.instance})"
          data-tooltip="Results"
            ><span class="glyphicon glyphicon-list-alt"></span
          ></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-primary"
          onclick="eNMS.base.showTypePanel('device', '${row.id}')" data-tooltip="Edit"
            ><span class="glyphicon glyphicon-edit"></span
          ></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-primary"
          onclick="eNMS.base.showTypePanel('device', '${row.id}', 'duplicate')"
          data-tooltip="Duplicate"
            ><span class="glyphicon glyphicon-duplicate"></span
          ></button>
        </li>
        ${this.deleteInstanceButton(row)}
      </ul>`;
  }

};

tables.configuration = class ConfigurationTable extends Table {
  get modelFiltering() {
    return "device";
  }

  postProcessing(...args) {
    super.postProcessing(...args);
    $("#slider").bootstrapSlider({
      value: 0,
      ticks: [...Array(6).keys()],
      formatter: (value) => `Lines of context: ${value}`,
      tooltip: "always",
    });
    $("#slider").on("change", function() {
      refreshTable("configuration");
    });
  }

  get controls() {
    return [
      this.columnDisplay(),
      `<input
        name="context-lines"
        id="slider"
        class="slider"
        style="width: 200px"
      >`,
    ];
  }

  buttons(row) {
    return `
      <ul class="pagination pagination-lg" style="margin: 0px">
        <li>
          <button type="button" class="btn btn-sm btn-info"
          onclick="eNMS.inventory.showDeviceData(${row.instance})"
          data-tooltip="Network Data"
            ><span class="glyphicon glyphicon-cog"></span
          ></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-info"
          onclick="eNMS.inventory.showGitHistory(${row.instance})"
          data-tooltip="Historic"
            ><span class="glyphicon glyphicon-adjust"></span
          ></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-primary"
          onclick="eNMS.base.showTypePanel('device', '${row.id}')" data-tooltip="Edit"
            ><span class="glyphicon glyphicon-edit"></span
          ></button>
        </li>
      </ul>`;
  }

};

class Base {}

models.link = class Link extends Base {
  static controls() {
    return [
      super.columnDisplay(),
      super.createNewButton("link"),
      super.searchTableButton("link"),
      super.refreshTableButton("link"),
    ];
  }

  get buttons() {
    return `
      <ul class="pagination pagination-lg" style="margin: 0px; width: 120px">
        <li>
          <button type="button" class="btn btn-sm btn-primary"
          onclick="eNMS.base.showTypePanel('link', '${this.id}')" data-tooltip="Edit"
            ><span class="glyphicon glyphicon-edit"></span
          ></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-primary"
          onclick="eNMS.base.showTypePanel('link', '${this.id}', 'duplicate')"
          data-tooltip="Duplicate"
            ><span class="glyphicon glyphicon-duplicate"></span
          ></button>
        </li>
        ${this.deleteInstanceButton}
      </ul>`;
  }
};

models.pool = class Pool extends Base {
  get objectNumber() {
    return `${this.device_number} devices - ${this.link_number} links`;
  }

  static controls() {
    return [
      super.columnDisplay(),
      super.createNewButton("pool"),
      ` <button
        class="btn btn-primary"
        onclick="eNMS.inventory.updatePools()"
        data-tooltip="Update all pools"
        type="button"
      >
        <span class="glyphicon glyphicon-flash"></span>
      </button>`,
      super.searchTableButton("pool"),
      super.refreshTableButton("pool"),
    ];
  }

  get buttons() {
    return `
      <ul class="pagination pagination-lg" style="margin: 0px; width: 230px">
        <li>
          <button type="button" class="btn btn-sm btn-info"
          onclick="eNMS.visualization.showPoolView('${this.id}')"
          data-tooltip="Internal View">
          <span class="glyphicon glyphicon-eye-open"></span></button>
        </li>
        <li>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            onclick="eNMS.inventory.showPoolObjectsPanel('${this.id}')"
            data-tooltip="Pool Objects"
          ><span class="glyphicon glyphicon-wrench"></span
          ></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-primary"
          onclick="eNMS.inventory.updatePools('${this.id}')"
          data-tooltip="Update"><span class="glyphicon glyphicon-refresh">
          </span></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-primary"
          onclick="eNMS.base.showTypePanel('pool', '${this.id}')" data-tooltip="Edit"
            ><span class="glyphicon glyphicon-edit"></span
          ></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-primary"
          onclick="eNMS.base.showTypePanel('pool', '${this.id}', 'duplicate')"
          data-tooltip="Duplicate"
            ><span class="glyphicon glyphicon-duplicate"></span
          ></button>
        </li>
        ${this.deleteInstanceButton}
      </ul>
    `;
  }
};

models.service = class Service extends Base {
  constructor(kwargs) {
    const dbName = kwargs.properties.name;
    delete kwargs.properties.name;
    super(kwargs);
    this.dbName = dbName;
  }

  get name() {
    return this.type === "workflow"
      ? `<b><a href="#" onclick="eNMS.workflow.switchToWorkflow(
      ${this.id})">${this.scoped_name}</a></b>`
      : $("#parent-filtering").val() == "true"
      ? this.scoped_name
      : this.dbName;
  }

  static controls() {
    return [
      super.columnDisplay(),
      `
      <input type="hidden" id="workflow-filtering" name="workflow-filtering">
      <button
        style="background:transparent; border:none; 
        color:transparent; width: 300px;"
        type="button"
      >
        <select
          id="parent-filtering"
          name="parent-filtering"
          class="form-control"
        >
          <option value="true">Display services hierarchically</option>
          <option value="false">Display all services</option>
        </select>
      </button>
      </input>
      ${super.searchTableButton('service')}
      <button
        class="btn btn-info"
        onclick="eNMS.table.refreshTable('service', true)"
        data-tooltip="Refresh"
        type="button"
      >
        <span class="glyphicon glyphicon-refresh"></span>
      </button>
      <a
      id="left-arrow"
      class="btn btn-info disabled"
      onclick="action['Backward']()"
      type="button"
    >
      <span class="glyphicon glyphicon-chevron-left"></span>
    </a>
    <a
      id="right-arrow"
      class="btn btn-info disabled"
      onclick="action['Forward']()"
      type="button"
    >
      <span class="glyphicon glyphicon-chevron-right"></span>
    </a>
    <button
    class="btn btn-primary"
    onclick="eNMS.automation.openServicePanel()"
    data-tooltip="New"
    type="button"
  >
    <span class="glyphicon glyphicon-plus"></span>
  </button>
  <button
    style="background:transparent; border:none; 
    color:transparent; width: 200px;"
    type="button"
  >
    <select id="service-type" class="form-control"></select>
  </button>
    `,
    ];
  }

  get buttons() {
    return `
      <ul class="pagination pagination-lg" style="margin: 0px; width: 270px">
        <li>
          <button type="button" class="btn btn-sm btn-info"
          onclick="eNMS.automation.showRuntimePanel('results', ${this.instance})"
          data-tooltip="Results"><span class="glyphicon glyphicon-list-alt">
          </span></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-info"
          onclick="eNMS.automation.showRuntimePanel('logs', ${this.instance})"
          data-tooltip="Logs"><span class="glyphicon glyphicon-list"></span
          ></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-success"
          onclick="eNMS.automation.normalRun('${this.id}')" data-tooltip="Run"
            ><span class="glyphicon glyphicon-play"></span
          ></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-success"
          onclick="eNMS.base.showTypePanel('${this.type}', '${this.id}', 'run')"
          data-tooltip="Parameterized Run"
            ><span class="glyphicon glyphicon-play-circle"></span
          ></button>
        </li>
        <li>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            onclick="eNMS.base.showTypePanel('${this.type}', '${this.id}')"
            data-tooltip="Edit"
          ><span class="glyphicon glyphicon-edit"></span></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-primary"
          onclick="eNMS.automation.exportService('${this.id}')" data-tooltip="Export"
            ><span class="glyphicon glyphicon-upload"></span
          ></button>
        </li>
        ${this.deleteInstanceButton}
      </ul>
    `;
  }

  static postProcessing(...args) {
    super.postProcessing(...args);
    loadServiceTypes();
    $("#parent-filtering")
      .selectpicker()
      .on("change", function() {
        this.page(0).ajax.reload(null, false);
      });
  }
};

models.run = class Run extends Base {
  constructor(kwargs) {
    super(kwargs);
    this.service = JSON.stringify(this.service_properties).replace(/"/g, "'");
  }

  static controls() {
    return [
      super.columnDisplay(),
      super.searchTableButton('run'),
      super.refreshTableButton("run"),
      ` <button
        class="btn btn-info"
        onclick="eNMS.automation.displayCalendar('run')"
        data-tooltip="Calendar"
        type="button"
      >
        <span class="glyphicon glyphicon-calendar"></span>
      </button>`,
    ];
  }

  get buttons() {
    return [
      `<ul class="pagination pagination-lg" style="margin: 0px; width: 100px">
        <li>
          <button type="button" class="btn btn-sm btn-info"
          onclick="eNMS.automation.showRuntimePanel('logs', ${this.service},
          '${this.runtime}')" data-tooltip="Logs">
          <span class="glyphicon glyphicon-list"></span></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-info"
          onclick="eNMS.automation.showRuntimePanel('results', ${this.service},
          '${this.runtime}')" data-tooltip="Results">
          <span class="glyphicon glyphicon-list-alt"></span></button>
        </li>
      </ul>`,
    ];
  }
};

models.result = class Result extends Base {
  constructor({ properties, tableId }) {
    const status = properties.success;
    delete properties.success;
    delete properties.result;
    super({
      properties: properties,
      tableId: tableId,
      derivedProperties: ["service_name", "device_name"],
    });
    this.status = status;
  }

  get success() {
    const btn = this.status ? "success" : "danger";
    const label = this.status ? "Success" : "Failure";
    return `
      <button
        type="button"
        class="btn btn-${btn} btn-sm"
        style="width:100%">${label}
      </button>`;
  }

  get v1() {
    return `<input type="radio" name="v1-${this.tableId}" value="${this.id}">`;
  }

  get v2() {
    return `<input type="radio" name="v2-${this.tableId}" value="${this.id}">`;
  }

  static controls(tableId) {
    return [
      `<button
        class="btn btn-info"
        onclick="eNMS.automation.compare('result', '${tableId}')"
        data-tooltip="Compare"
        type="button"
      >
        <span class="glyphicon glyphicon-adjust"></span>
      </button>`,
      super.refreshTableButton("result"),
    ];
  }

  get buttons() {
    return [
      `
    <ul class="pagination pagination-lg" style="margin: 0px; width: 90px">
      <li>
          <button type="button" class="btn btn-sm btn-info"
          onclick="eNMS.automation.showResult('${this.id}')"
          data-tooltip="Results"><span class="glyphicon glyphicon-list-alt">
          </span></button>
      </li>
      <li>
          <button
            type="button"
            id="btn-result-${this.id}"
            class="btn btn-sm btn-info"
            onclick="eNMS.automation.copyClipboard(
              'btn-result-${this.id}', ${this.instance}
            )"
            data-tooltip="Copy to clipboard"
          ><span class="glyphicon glyphicon-copy"></span></button>
      </li>
    </ul>`,
    ];
  }
};

models.device_result = class DeviceResult extends models.result {
  static get modelFiltering() {
    return "result";
  }
};

models.task = class Task extends Base {
  get periodicity() {
    if (this.scheduling_mode == "standard") {
      return `${this.frequency} ${this.frequency_unit}`;
    } else {
      return this.crontab_expression;
    }
  }

  static controls() {
    return [
      super.columnDisplay(),
      super.createNewButton("task"),
      super.searchTableButton("task"),
      super.refreshTableButton("task"),
      ` <button
        class="btn btn-info"
        onclick="eNMS.automation.displayCalendar('task')"
        data-tooltip="Calendar"
        type="button"
      >
        <span class="glyphicon glyphicon-calendar"></span>
      </button>
      <button type="button" class="btn btn-success"
      onclick="eNMS.automation.schedulerAction('resume')" data-tooltip="Play"
        ><span class="glyphicon glyphicon-play"></span
      ></button>
      <button type="button" class="btn btn-danger"
      onclick="eNMS.automation.schedulerAction('pause')" data-tooltip="Pause"
        ><span class="glyphicon glyphicon-pause"></span
      ></button>`,
    ];
  }

  get buttons() {
    const state = this.is_active ? ["disabled", "active"] : ["active", "disabled"];
    return [
      `<ul class="pagination pagination-lg" style="margin: 0px;">
        <li>
          <button type="button" class="btn btn-sm btn-primary"
          onclick="eNMS.base.showTypePanel('task', '${this.id}')" data-tooltip="Edit"
            ><span class="glyphicon glyphicon-edit"></span
          ></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-primary"
          onclick="eNMS.base.showTypePanel('task', '${this.id}', 'duplicate')"
          data-tooltip="Duplicate">
          <span class="glyphicon glyphicon-duplicate"></span></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-success ${state[0]}" ${state[0]}
          onclick="eNMS.automation.resumeTask('${this.id}')" data-tooltip="Play"
            ><span class="glyphicon glyphicon-play"></span
          ></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-danger ${state[1]}" ${state[1]}
          onclick="eNMS.automation.pauseTask('${this.id}')" data-tooltip="Pause"
            ><span class="glyphicon glyphicon-pause"></span
          ></button>
        </li>
        ${this.deleteInstanceButton}
      </ul>`,
    ];
  }
};

models.user = class User extends Base {
  static controls() {
    return [
      super.columnDisplay(),
      super.createNewButton("user"),
      super.refreshTableButton("user"),
    ];
  }

  get buttons() {
    return [
      `
      <ul class="pagination pagination-lg" style="margin: 0px;">
        <li>
          <button type="button" class="btn btn-sm btn-primary"
          onclick="eNMS.base.showTypePanel('user', '${this.id}')" data-tooltip="Edit"
            ><span class="glyphicon glyphicon-edit"></span
          ></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-primary"
          onclick="eNMS.base.showTypePanel('user', '${this.id}', 'duplicate')"
          data-tooltip="Duplicate"
            ><span class="glyphicon glyphicon-duplicate"></span
          ></button>
        </li>
        ${this.deleteInstanceButton}
      </ul>`,
    ];
  }
};

models.server = class Server extends Base {
  static controls() {
    return [
      super.columnDisplay(),
      super.createNewButton("server"),
      super.refreshTableButton("server"),
    ];
  }

  get buttons() {
    return [
      `
      <ul class="pagination pagination-lg" style="margin: 0px;">
        <li>
          <button type="button" class="btn btn-sm btn-primary"
          onclick="eNMS.base.showTypePanel('server', '${this.id}')" data-tooltip="Edit"
            ><span class="glyphicon glyphicon-edit"></span
          ></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-primary"
          onclick="eNMS.base.showTypePanel('server', '${this.id}', 'duplicate')"
          data-tooltip="Duplicate"
            ><span class="glyphicon glyphicon-duplicate"></span
          ></button>
        </li>
        ${this.deleteInstanceButton}
      </ul>`,
    ];
  }
};

models.changelog = class Changelog extends Base {
  static controls() {
    return [
      super.columnDisplay(),
      super.createNewButton("changelog"),
      super.refreshTableButton("changelog"),
    ];
  }
};

models.session = class Session extends Base {
  static controls() {
    return [super.columnDisplay(), super.refreshTableButton("session")];
  }

  get buttons() {
    return [
      `
      <ul class="pagination pagination-lg" style="margin: 0px;">
        <li>
          <button type="button" class="btn btn-sm btn-info"
          onclick="eNMS.inventory.showSessionLog(${this.id})" data-tooltip="Session Log"
            ><span class="glyphicon glyphicon-list"></span
          ></button>
        </li>
      </ul>`,
    ];
  }
};

models.event = class Event extends Base {
  static controls() {
    return [
      super.columnDisplay(),
      super.createNewButton("event"),
      super.refreshTableButton("event"),
    ];
  }

  get buttons() {
    return [
      `
      <ul class="pagination pagination-lg" style="margin: 0px; width: 150px">
        <li>
          <button type="button" class="btn btn-sm btn-primary"
          onclick="eNMS.base.showTypePanel('event', '{self.id}')"
          data-tooltip="Edit"><span class="glyphicon glyphicon-edit">
          </span></button>
        </li>
        <li>
          <button type="button" class="btn btn-sm btn-primary"
          onclick="eNMS.base.showTypePanel('event', '{self.id}', 'duplicate')"
          data-tooltip="Duplicate">
          <span class="glyphicon glyphicon-duplicate"></span></button>
        </li>
        ${this.deleteInstanceButton}
      </ul>
    `,
    ];
  }
};

configureNamespace("table", [filterTable, refreshTable, refreshTablePeriodically]);
