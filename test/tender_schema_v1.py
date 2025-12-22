from typing import List, Optional, Dict
from datetime import datetime, date
from pydantic import BaseModel, Field, validator, model_validator
from typing_extensions import Literal
import re


# -------------------------
# Core helper models
# -------------------------

class TechnicalSpecification(BaseModel):
    section: Optional[str] = None
    name: str
    value: str


class BOQItem(BaseModel):
    sl_no: Optional[int] = None
    description: str
    quantity: Optional[float] = None
    unit: Optional[str] = None


class BOQ(BaseModel):
    title: Optional[str] = None
    items: List[BOQItem]


# -------------------------
# Main Tender Schema (v1)
# -------------------------

class TenderSchemaV1(BaseModel):
    # -------------------------
    # A. Tender Core
    # -------------------------
    bid_number: str
    bid_date: Optional[date] = None
    bid_end_datetime: datetime
    bid_open_datetime: Optional[datetime] = None
    bid_offer_validity_days: Optional[int] = None

    # -------------------------
    # B. Buyer / Organisation
    # -------------------------
    ministry_name: Optional[str] = None
    department_name: Optional[str] = None
    organisation_name: Optional[str] = None
    office_name: Optional[str] = None
    buyer_email: Optional[str] = None

    # -------------------------
    # C. Item & Category
    # -------------------------
    item_category: str
    item_category_source: Literal[
        "pdf_header",
        "boq_title",
        "boq_item",
        "spec_heading",
    ]

    product_title: Optional[str] = None
    total_quantity: float
    quantity_unit: Optional[str] = None

    # -------------------------
    # D. Documents Required
    # -------------------------
    documents_required: List[str]
    documents_required_source: Literal["pdf_header"]

    # -------------------------
    # E. Bid Configuration
    # -------------------------
    type_of_bid: Optional[str] = None
    evaluation_method: Optional[str] = None
    inspection_required: Optional[bool] = None
    bid_to_ra_enabled: Optional[bool] = None

    # -------------------------
    # F. Financial Securities
    # -------------------------
    emd_required: Optional[bool] = None
    emd_amount: Optional[float] = None

    epbg_required: Optional[bool] = None
    epbg_percentage: Optional[float] = None

    # -------------------------
    # G. Warranty & Maintenance
    # -------------------------
    warranty_period_years: Optional[int] = None

    # -------------------------
    # H. Technical Specifications
    # -------------------------
    technical_specifications: List[TechnicalSpecification] = Field(default_factory=list)

    # -------------------------
    # I. BOQ
    # -------------------------
    boq: Optional[BOQ] = None

    # -------------------------
    # J. Validation
    # -------------------------

    @validator("bid_number")
    def validate_bid_number(cls, v: str) -> str:
        if not re.match(r"^GEM/\d{4}/B/\d+$", v):
            raise ValueError(f"Invalid bid_number format: {v}")
        return v

    @validator("documents_required")
    def validate_documents_required(cls, v: List[str]) -> List[str]:
        if v is None:
            raise ValueError("documents_required must not be None")
        return v

    @model_validator(mode="after")
    def validate_item_category(self):
        if not self.item_category or not self.item_category_source:
            raise ValueError("item_category and item_category_source are mandatory")
        return self
