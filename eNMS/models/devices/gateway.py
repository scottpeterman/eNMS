from sqlalchemy import ForeignKey, Integer
from sqlalchemy.orm import relationship

from eNMS.database import db
from eNMS.fields import MultipleInstanceField
from eNMS.forms import DeviceForm
from eNMS.fields import HiddenField
from eNMS.models.inventory import Device


class Gateway(Device):

    __tablename__ = "gateway"
    __mapper_args__ = {"polymorphic_identity": "gateway"}
    pretty_name = "Gateway"
    id = db.Column(Integer, ForeignKey("device.id"), primary_key=True)
    devices = relationship(
        "Device", secondary=db.device_gateway_table, back_populates="gateways"
    )


class GatewayForm(DeviceForm):
    form_type = HiddenField(default="gateway")
    devices = MultipleInstanceField("Devices", model="device")
    properties = ["devices"]
