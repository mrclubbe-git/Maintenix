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



EXACT_FAILING_NAME = "SEC-TEST-REPAIR-1792311564029 VALID NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN"
EXACT_FAILING_DESIGNATION = "SEC-TEST Synthetic Engineering Acceptance DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"


class ExactBoundaryRegressionTests(unittest.TestCase):
    def test_captured_120_160_unbroken_values_pass_when_rendered_as_fragments(self):
        self.assertEqual(len(EXACT_FAILING_NAME), 120)
        self.assertEqual(len(EXACT_FAILING_DESIGNATION), 160)

        name_prefix, name_padding = EXACT_FAILING_NAME.rsplit(" ", 1)
        designation_prefix, designation_padding = EXACT_FAILING_DESIGNATION.rsplit(" ", 1)

        name_parts = [name_padding[:34], name_padding[34:68], name_padding[68:]]
        designation_parts = [
            designation_padding[:36],
            designation_padding[36:72],
            designation_padding[72:108],
            designation_padding[108:],
        ]

        pdf_text = f"""
5. Compiled By
Name                                      Designation / Position                         Date Compiled
{name_prefix}                             {designation_prefix}                           18 October 2026
{name_parts[0]}                           {designation_parts[0]}
{name_parts[1]}                           {designation_parts[1]}
{name_parts[2]}                           {designation_parts[2]}
                                          {designation_parts[3]}
"""

        self.assertTrue(
            compiled_section_has_content(
                pdf_text,
                EXACT_FAILING_NAME,
                EXACT_FAILING_DESIGNATION,
            )
        )

    def test_captured_unbroken_value_still_fails_if_a_rendered_fragment_is_missing(self):
        name_prefix, name_padding = EXACT_FAILING_NAME.rsplit(" ", 1)
        designation_prefix, designation_padding = EXACT_FAILING_DESIGNATION.rsplit(" ", 1)

        pdf_text = f"""
5. Compiled By
{name_prefix}                             {designation_prefix}
{name_padding[:34]}                       {designation_padding[:36]}
{name_padding[34:68]}                     {designation_padding[36:72]}
{name_padding[68:]}                       {designation_padding[72:108]}
"""

        self.assertFalse(
            compiled_section_has_content(
                pdf_text,
                EXACT_FAILING_NAME,
                EXACT_FAILING_DESIGNATION,
            )
        )

if __name__ == "__main__":
    unittest.main()
