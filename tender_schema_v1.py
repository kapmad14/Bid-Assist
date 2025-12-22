from __future__ import annotations

from typing import List, Optional, Literal, Dict
from datetime import datetime, date
from pydantic import BaseModel, Field, validator, root_validator
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
    # A. Tender Core (MANDATORY)
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
    # C. Item & Category (MANDATORY)
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
    # D. Documents Required (MANDATORY)
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
    ra_qualification_rule: Optional[str] = None
    time_allowed_for_technical_clarifications_days: Optional[int] = None

    # -------------------------
    # F. Eligibility & Preferences
    # -------------------------
    years_of_past_experience_required: Optional[int] = None

    minimum_average_annual_turnover_lakh: Optional[float] = None
    oem_average_turnover_lakh: Optional[float] = None

    mse_exemption_experience: Optional[bool] = None
    mse_exemption_turnover: Optional[bool] = None

    startup_exemption_experience: Optional[bool] = None
    startup_exemption_turnover: Optional[bool] = None

    mse_purchase_preference: Optional[bool] = None
    mii_purchase_preference: Optional[bool] = None

    # -------------------------
    # G. Financial Securities
    # -------------------------
    emd_required: Optional[bool] = None
    emd_amount: Optional[float] = None
    emd_bank: Optional[str] = None
    emd_beneficiary: Optional[str] = None

    epbg_required: Optional[bool] = None
    epbg_percentage: Optional[float] = None
    epbg_duration_months: Optional[int] = None
    epbg_bank: Optional[str] = None

    # -------------------------
    # H. Warranty & Maintenance
    # -------------------------
    warranty_period_years: Optional[int] = None
    comprehensive_maintenance_required: Optional[bool] = None
    cmc_duration_years: Optional[int] = None

    # -------------------------
    # I. Technical Specifications
    # -------------------------
    technical_specifications: List[TechnicalSpecification] = Field(
        default_factory=list
    )

    # -------------------------
    # J. BOQ
    # -------------------------
    boq: Optional[BOQ] = None

    # -------------------------
    # K. Extraction Meta (TESTING ONLY)
    # -------------------------
    extraction_warnings: List[str] = Field(default_factory=list)
    field_sources: Dict[str, str] = Field(default_factory=dict)

    # -------------------------
    # Validators
    # -------------------------

    @validator("bid_number")
    def validate_bid_number(cls, v: str) -> str:
        if not re.match(r"^GEM/\d{4}/B/\d+$", v):
            raise ValueError(f"Invalid bid_number format: {v}")
        return v

    @validator("documents_required")
    def validate_documents_required(cls, v: List[str]) -> List[str]:
        # Explicit empty list is allowed, but None is not
        if v is None:
            raise ValueError("documents_required must be present (empty list allowed)")
        return v

    @root_validator
    def validate_item_category_source(cls, values):
        item_category = values.get("item_category")
        source = values.get("item_category_source")

        if not item_category or not source:
            raise ValueError("item_category and item_category_source are mandatory")

        return values
    