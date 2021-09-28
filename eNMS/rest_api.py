from collections import defaultdict
from flask_login import current_user
from itsdangerous import TimedJSONWebSignatureSerializer
from os import getenv
from threading import Thread
from traceback import format_exc
from uuid import getnode

from eNMS.controller import controller
from eNMS.database import db
from eNMS.variables import vs


class RestApi:

    rest_endpoints = {
        "GET": {
            "configuration": "get_configuration",
            "instance": "get_instance",
            "is_alive": "is_alive",
            "query": "query",
            "result": "get_result",
            "token": "get_token",
        },
        "POST": {
            "instance": "update_instance",
            "migrate": "migrate",
            "run_service": "run_service",
            "run_task": "run_task",
            "search": "search",
            "topology": "topology",
        },
        "DELETE": {
            "instance": "delete_instance",
        },
    }

    allowed_endpoints = [
        "get_cluster_status",
        "get_git_content",
        "update_all_pools",
        "update_database_configurations_from_git",
    ]

    def __init__(self):
        for endpoint in self.allowed_endpoints:
            self.rest_endpoints["POST"][endpoint] = endpoint
            setattr(self, endpoint, getattr(controller, endpoint))

    def delete_instance(self, model, name):
        return db.delete(model, name=name)

    def get_configuration(self, device_name, property="configuration", **_):
        return getattr(db.fetch("device", name=device_name), property)

    def get_instance(self, model, name, **_):
        return db.fetch(model, name=name).to_dict(
            relation_names_only=True, exclude=["positions"]
        )

    def get_result(self, name, runtime, **_):
        run = db.fetch("run", service_name=name, runtime=runtime, allow_none=True)
        if not run:
            error_message = (
                "There are no results or on-going services "
                "for the requested service and runtime."
            )
            return {"error": error_message}
        else:
            result = run.result()
            return {
                "status": run.status,
                "result": result.result if result else "No results yet.",
            }

    def get_token(self):
        return (
            TimedJSONWebSignatureSerializer(
                getenv("SECRET_KEY", "secret_key"),
                expires_in=vs.settings["app"]["session_timeout_minutes"] * 60,
            )
            .dumps({"id": current_user.id})
            .decode("ascii")
        )

    def is_alive(self, **_):
        return {"name": getnode(), "cluster_id": vs.settings["cluster"]["id"]}

    def migrate(self, direction, **kwargs):
        return getattr(controller, f"migration_{direction}")(**kwargs)

    def query(self, model, **kwargs):
        results = db.fetch(model, all_matches=True, **kwargs)
        return [result.get_properties(exclude=["positions"]) for result in results]

    def run_service(self, **kwargs):
        data = {"trigger": "REST", "creator": current_user.name, **kwargs}
        errors, devices, pools = [], [], []
        service = db.fetch("service", name=data.pop("name"), rbac="run")
        handle_asynchronously = data.get("async", False)
        for device_name in data.get("devices", ""):
            device = db.fetch("device", name=device_name)
            if device:
                devices.append(device.id)
            else:
                errors.append(f"No device with the name '{device_name}'")
        for device_ip in data.get("ip_addresses", ""):
            device = db.fetch("device", ip_address=device_ip)
            if device:
                devices.append(device.id)
            else:
                errors.append(f"No device with the IP address '{device_ip}'")
        for pool_name in data.get("pools", ""):
            pool = db.fetch("pool", name=pool_name)
            if pool:
                pools.append(pool.id)
            else:
                errors.append(f"No pool with the name '{pool_name}'")
        if errors:
            return {"errors": errors}
        if devices or pools:
            data.update({"target_devices": devices, "target_pools": pools})
        data["runtime"] = runtime = vs.get_time()
        if handle_asynchronously:
            Thread(target=controller.run, args=(service.id,), kwargs=data).start()
            return {"errors": errors, "runtime": runtime}
        else:
            return {**controller.run(service.id, **data), "errors": errors}

    def run_task(self, task_id):
        task = db.fetch("task", rbac="schedule", id=task_id)
        data = {
            "trigger": "Scheduler",
            "creator": task.last_scheduled_by,
            "runtime": vs.get_time(),
            "task": task.id,
            **task.initial_payload,
        }
        if task.devices:
            data["target_devices"] = [device.id for device in task.devices]
        if task.pools:
            data["target_pools"] = [pool.id for pool in task.pools]
        Thread(target=controller.run, args=(task.service.id,), kwargs=data).start()

    def search(self, **kwargs):
        filtering_kwargs = {
            "draw": 1,
            "columns": [{"data": column} for column in kwargs["columns"]],
            "order": kwargs.get("order", [{"column": 0, "dir": "asc"}]),
            "start": kwargs.get("start", 0),
            "length": kwargs.get("maximum_return_records", 10),
            "form": kwargs.get("search_criteria", {}),
            "rest_api_request": True,
        }
        return controller.filtering(kwargs["type"], **filtering_kwargs)["data"]

    def topology(self, direction, **kwargs):
        if direction == "import":
            result = controller.import_topology(
                **{
                    "replace": kwargs["replace"] == "True",
                    "file": kwargs["file"],
                }
            )
            return result, 206 if "Partial" in result else 200
        else:
            controller.topology_export(**kwargs)
            return "Topology Export successfully executed."

    def update_instance(self, model, list_data=None, **data):
        result, data = defaultdict(list), list_data or [data]
        for instance in data:
            if "name" not in instance:
                result["failure"].append((instance, "Name is missing"))
                continue
            try:
                object_data = controller.objectify(model, instance)
                object_data["update_pools"] = instance.get("update_pools", True)
                instance = db.factory(model, **object_data)
                result["success"].append(instance.name)
            except Exception:
                result["failure"].append((instance, format_exc()))
        return result
