#!/usr/bin/env python3

import unittest

from text_validation import compiled_section_has_content


class CompiledSectionTextTests(unittest.TestCase):
    def test_short_contiguous_values_pass(self):
        pdf_text = """
5. Compiled By
SEC TEST USER    Technician    18 October 2026
"""
        self.assertTrue(
            compiled_section_has_content(pdf_text, "SEC TEST USER", "Technician")
        )

    def test_wrapped_adjacent_cells_can_be_interleaved(self):
        name = (
            "SEC-TEST Alexandra Catherine Elizabeth Montgomery Wellington van der "
            "Merwe Sutherland Margaret Charlotte Louise Jacobs"
        )
        designation = (
            "Senior Electrical Maintenance and Fire Protection Systems Compliance "
            "Coordinator for Industrial Infrastructure and Operational Safety - Synthetic DEV Acceptance"
        )
        pdf_text = """
5. Compiled By
SEC-TEST Alexandra Catherine Elizabeth     Senior Electrical Maintenance and Fire Protection
Montgomery Wellington van der Merwe        Systems Compliance Coordinator for Industrial
Sutherland Margaret Charlotte Louise       Infrastructure and Operational Safety - Synthetic
Jacobs                                     DEV Acceptance
18 October 2026
"""
        self.assertTrue(compiled_section_has_content(pdf_text, name, designation))

    def test_missing_compiler_token_fails(self):
        pdf_text = """
5. Compiled By
SEC TEST USER    Senior Electrical Maintenance
"""
        self.assertFalse(
            compiled_section_has_content(
                pdf_text,
                "SEC TEST USER",
                "Senior Electrical Maintenance Coordinator"
            )
        )

    def test_missing_heading_fails(self):
        self.assertFalse(
            compiled_section_has_content(
                "SEC TEST USER Technician",
                "SEC TEST USER",
                "Technician"
            )
        )


if __name__ == "__main__":
    unittest.main()
