// Entirely synthetic test data. No private quotation/source text.
export default {
  "metadata": {
    "quote_count": 12,
    "quote_groups": 10,
    "air_sea_pairs": 2,
    "synthetic": true
  },
  "quotes": [
    {
      "source": {
        "message_id": 1001,
        "kind": "synthetic_test_fixture"
      },
      "raw_transcription": {
        "carrier": null,
        "volumetric_kg": 160,
        "total_usd": 2400
      },
      "normalized": {
        "mode": "sea",
        "mode_evidence": "explicit_caption",
        "carrier": "Ukr China",
        "destination": "Mukachevo",
        "carrier_service_line": null,
        "aggregate_loads": null,
        "incoterm": "FOB",
        "payment_status": "not_evidenced",
        "quote_group": "synthetic-group-1",
        "document_date": "2026-08-01",
        "valid_until": "2026-08-10",
        "freight_usd": 200,
        "total_usd": 215,
        "insurance_usd": 15,
        "gross_kg": 20,
        "volume_m3": 0.24,
        "volumetric_kg": null
      },
      "quarantine": [],
      "curation": {
        "category": "bumper-kit",
        "quantity": 3,
        "mixed_load": true,
        "basis": "synthetic_fixture",
        "note": "Category-level match; no mandatory SKU catalog. Quantity is contents of quoted load, not independent observations."
      }
    },
    {
      "source": {
        "message_id": 1002,
        "kind": "synthetic_test_fixture"
      },
      "raw_transcription": {
        "carrier": null,
        "volumetric_kg": 160,
        "total_usd": 2400
      },
      "normalized": {
        "mode": "air",
        "mode_evidence": "explicit_caption",
        "carrier": "Ukr China",
        "destination": "Mukachevo",
        "carrier_service_line": null,
        "aggregate_loads": null,
        "incoterm": "FOB",
        "payment_status": "not_evidenced",
        "quote_group": "synthetic-group-1",
        "document_date": null,
        "valid_until": "2026-08-10",
        "freight_usd": 450,
        "total_usd": null,
        "insurance_usd": 15,
        "gross_kg": 20,
        "volume_m3": 0.24,
        "volumetric_kg": null
      },
      "quarantine": [
        {
          "field": "total_usd",
          "reason": "synthetic conflict fixture"
        },
        {
          "field": "volumetric_kg",
          "reason": "synthetic conflict fixture"
        },
        {
          "field": "document_date",
          "reason": "synthetic conflict fixture"
        }
      ],
      "curation": {
        "category": "bumper-kit",
        "quantity": 3,
        "mixed_load": true,
        "basis": "synthetic_fixture",
        "note": "Category-level match; no mandatory SKU catalog. Quantity is contents of quoted load, not independent observations."
      }
    },
    {
      "source": {
        "message_id": 1003,
        "kind": "synthetic_test_fixture"
      },
      "raw_transcription": {
        "carrier": null,
        "volumetric_kg": 160,
        "total_usd": 2400
      },
      "normalized": {
        "mode": "sea",
        "mode_evidence": "explicit_caption",
        "carrier": "Ukr China",
        "destination": "Kyiv",
        "carrier_service_line": null,
        "aggregate_loads": 3,
        "incoterm": "FOB",
        "payment_status": "not_evidenced",
        "quote_group": "synthetic-group-2",
        "document_date": "2026-08-01",
        "valid_until": "2026-08-10",
        "freight_usd": 200,
        "total_usd": 215,
        "insurance_usd": 15,
        "gross_kg": 20,
        "volume_m3": 0.24,
        "volumetric_kg": null
      },
      "quarantine": [],
      "curation": {
        "category": "mixed",
        "quantity": null,
        "mixed_load": true,
        "basis": "synthetic_fixture",
        "note": "Category-level match; no mandatory SKU catalog. Quantity is contents of quoted load, not independent observations."
      }
    },
    {
      "source": {
        "message_id": 1004,
        "kind": "synthetic_test_fixture"
      },
      "raw_transcription": {
        "carrier": null,
        "volumetric_kg": 160,
        "total_usd": 2400
      },
      "normalized": {
        "mode": "air",
        "mode_evidence": "inferred_from_volumetric_row",
        "carrier": "Ukr China",
        "destination": "Kyiv",
        "carrier_service_line": null,
        "aggregate_loads": null,
        "incoterm": null,
        "payment_status": "not_evidenced",
        "quote_group": "synthetic-group-3",
        "document_date": "2026-08-01",
        "valid_until": "2026-08-10",
        "freight_usd": 450,
        "total_usd": 465,
        "insurance_usd": 15,
        "gross_kg": 20,
        "volume_m3": 0.24,
        "volumetric_kg": null
      },
      "quarantine": [
        {
          "field": "incoterm",
          "reason": "synthetic conflict fixture"
        }
      ],
      "curation": {
        "category": "door-glass",
        "quantity": 1,
        "mixed_load": false,
        "basis": "synthetic_fixture",
        "note": "Category-level match; no mandatory SKU catalog. Quantity is contents of quoted load, not independent observations."
      }
    },
    {
      "source": {
        "message_id": 1005,
        "kind": "synthetic_test_fixture"
      },
      "raw_transcription": {
        "carrier": null,
        "volumetric_kg": 160,
        "total_usd": 2400
      },
      "normalized": {
        "mode": "air",
        "mode_evidence": "inferred_from_volumetric_row",
        "carrier": "Ukr China",
        "destination": "Kyiv",
        "carrier_service_line": null,
        "aggregate_loads": null,
        "incoterm": "FCA",
        "payment_status": "not_evidenced",
        "quote_group": "synthetic-group-4",
        "document_date": "2026-08-01",
        "valid_until": "2026-08-10",
        "freight_usd": 450,
        "total_usd": 465,
        "insurance_usd": 15,
        "gross_kg": 20,
        "volume_m3": 0.24,
        "volumetric_kg": null
      },
      "quarantine": [],
      "curation": {
        "category": "headlamp",
        "quantity": 2,
        "mixed_load": true,
        "basis": "synthetic_fixture",
        "note": "Category-level match; no mandatory SKU catalog. Quantity is contents of quoted load, not independent observations."
      }
    },
    {
      "source": {
        "message_id": 1006,
        "kind": "synthetic_test_fixture"
      },
      "raw_transcription": {
        "carrier": null,
        "volumetric_kg": 160,
        "total_usd": 2400
      },
      "normalized": {
        "mode": "air",
        "mode_evidence": "inferred_from_volumetric_row",
        "carrier": "Ukr China",
        "destination": "Kyiv",
        "carrier_service_line": null,
        "aggregate_loads": null,
        "incoterm": "FCA",
        "payment_status": "not_evidenced",
        "quote_group": "synthetic-group-5",
        "document_date": null,
        "valid_until": "2026-08-10",
        "freight_usd": 450,
        "total_usd": 465,
        "insurance_usd": 15,
        "gross_kg": 20,
        "volume_m3": 0.24,
        "volumetric_kg": null,
        "document_date_and_number": null
      },
      "quarantine": [
        {
          "field": "document_date_and_number",
          "reason": "synthetic conflict fixture"
        }
      ],
      "curation": {
        "category": "rear-lamp",
        "quantity": 1,
        "mixed_load": false,
        "basis": "synthetic_fixture",
        "note": "Category-level match; no mandatory SKU catalog. Quantity is contents of quoted load, not independent observations."
      }
    },
    {
      "source": {
        "message_id": 1007,
        "kind": "synthetic_test_fixture"
      },
      "raw_transcription": {
        "carrier": null,
        "volumetric_kg": 160,
        "total_usd": 2400
      },
      "normalized": {
        "mode": "air",
        "mode_evidence": "explicit_caption",
        "carrier": "Ukr China",
        "destination": "Kyiv",
        "carrier_service_line": null,
        "aggregate_loads": null,
        "incoterm": "FCA",
        "payment_status": "not_evidenced",
        "quote_group": "synthetic-group-7",
        "document_date": "2026-08-01",
        "valid_until": "2026-08-10",
        "freight_usd": 450,
        "total_usd": 465,
        "insurance_usd": 15,
        "gross_kg": 20,
        "volume_m3": 0.24,
        "volumetric_kg": null
      },
      "quarantine": [],
      "curation": {
        "category": "shock",
        "quantity": 2,
        "mixed_load": false,
        "basis": "synthetic_fixture",
        "note": "Category-level match; no mandatory SKU catalog. Quantity is contents of quoted load, not independent observations."
      }
    },
    {
      "source": {
        "message_id": 1008,
        "kind": "synthetic_test_fixture"
      },
      "raw_transcription": {
        "carrier": null,
        "volumetric_kg": 160,
        "total_usd": 2400
      },
      "normalized": {
        "mode": "sea",
        "mode_evidence": "explicit_caption",
        "carrier": "Ukr China",
        "destination": "Kyiv",
        "carrier_service_line": null,
        "aggregate_loads": null,
        "incoterm": "FCA",
        "payment_status": "not_evidenced",
        "quote_group": "synthetic-group-7",
        "document_date": "2026-08-01",
        "valid_until": "2026-08-10",
        "freight_usd": 200,
        "total_usd": 215,
        "insurance_usd": 15,
        "gross_kg": 20,
        "volume_m3": 0.24,
        "volumetric_kg": null
      },
      "quarantine": [],
      "curation": {
        "category": "shock",
        "quantity": 2,
        "mixed_load": false,
        "basis": "synthetic_fixture",
        "note": "Category-level match; no mandatory SKU catalog. Quantity is contents of quoted load, not independent observations."
      }
    },
    {
      "source": {
        "message_id": 1009,
        "kind": "synthetic_test_fixture"
      },
      "raw_transcription": {
        "carrier": null,
        "volumetric_kg": 160,
        "total_usd": 2400
      },
      "normalized": {
        "mode": "air",
        "mode_evidence": "explicit_caption",
        "carrier": "Ukr China",
        "destination": "Kyiv",
        "carrier_service_line": null,
        "aggregate_loads": 2,
        "incoterm": "FCA",
        "payment_status": "not_evidenced",
        "quote_group": "synthetic-group-8",
        "document_date": "2026-08-01",
        "valid_until": "2026-08-10",
        "freight_usd": 450,
        "total_usd": null,
        "insurance_usd": 15,
        "gross_kg": 20,
        "volume_m3": 0.24,
        "volumetric_kg": null
      },
      "quarantine": [
        {
          "field": "total_usd",
          "reason": "synthetic conflict fixture"
        }
      ],
      "curation": {
        "category": "mixed",
        "quantity": null,
        "mixed_load": true,
        "basis": "synthetic_fixture",
        "note": "Category-level match; no mandatory SKU catalog. Quantity is contents of quoted load, not independent observations."
      }
    },
    {
      "source": {
        "message_id": 1010,
        "kind": "synthetic_test_fixture"
      },
      "raw_transcription": {
        "carrier": null,
        "volumetric_kg": 160,
        "total_usd": 2400
      },
      "normalized": {
        "mode": "sea",
        "mode_evidence": "inferred_from_template_without_volumetric_row",
        "carrier": "Ukr China",
        "destination": "Kyiv",
        "carrier_service_line": null,
        "aggregate_loads": null,
        "incoterm": null,
        "payment_status": "not_evidenced",
        "quote_group": "synthetic-group-9",
        "document_date": "2026-08-01",
        "valid_until": "2026-08-10",
        "freight_usd": 200,
        "total_usd": 215,
        "insurance_usd": 15,
        "gross_kg": 20,
        "volume_m3": 0.24,
        "volumetric_kg": null
      },
      "quarantine": [
        {
          "field": "incoterm",
          "reason": "synthetic conflict fixture"
        }
      ],
      "curation": {
        "category": "mixed",
        "quantity": 10,
        "mixed_load": true,
        "basis": "synthetic_fixture",
        "note": "Category-level match; no mandatory SKU catalog. Quantity is contents of quoted load, not independent observations."
      }
    },
    {
      "source": {
        "message_id": 1011,
        "kind": "synthetic_test_fixture"
      },
      "raw_transcription": {
        "carrier": null,
        "volumetric_kg": 160,
        "total_usd": 2400
      },
      "normalized": {
        "mode": "sea",
        "mode_evidence": "inferred_from_template_without_volumetric_row",
        "carrier": "Ukr China",
        "destination": "Kyiv",
        "carrier_service_line": null,
        "aggregate_loads": null,
        "incoterm": "FOB",
        "payment_status": "not_evidenced",
        "quote_group": "synthetic-group-10",
        "document_date": "2026-08-01",
        "valid_until": "2026-08-10",
        "freight_usd": 200,
        "total_usd": 215,
        "insurance_usd": 15,
        "gross_kg": 20,
        "volume_m3": 0.24,
        "volumetric_kg": null
      },
      "quarantine": [],
      "curation": {
        "category": "mixed",
        "quantity": null,
        "mixed_load": true,
        "basis": "synthetic_fixture",
        "note": "Category-level match; no mandatory SKU catalog. Quantity is contents of quoted load, not independent observations."
      }
    },
    {
      "source": {
        "message_id": 1012,
        "kind": "synthetic_test_fixture"
      },
      "raw_transcription": {
        "carrier": null,
        "volumetric_kg": 160,
        "total_usd": 2400
      },
      "normalized": {
        "mode": "sea",
        "mode_evidence": "explicit_caption",
        "carrier": "Ukr China",
        "destination": "Kyiv",
        "carrier_service_line": null,
        "aggregate_loads": null,
        "incoterm": null,
        "payment_status": "not_evidenced",
        "quote_group": "synthetic-group-11",
        "document_date": "2026-08-01",
        "valid_until": "2026-08-10",
        "freight_usd": 200,
        "total_usd": 215,
        "insurance_usd": 15,
        "gross_kg": 20,
        "volume_m3": 0.24,
        "volumetric_kg": null
      },
      "quarantine": [
        {
          "field": "incoterm",
          "reason": "synthetic conflict fixture"
        }
      ],
      "curation": {
        "category": "radiator-frame",
        "quantity": 1,
        "mixed_load": false,
        "basis": "synthetic_fixture",
        "note": "Category-level match; no mandatory SKU catalog. Quantity is contents of quoted load, not independent observations."
      }
    }
  ]
};
