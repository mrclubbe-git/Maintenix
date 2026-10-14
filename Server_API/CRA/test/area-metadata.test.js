const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maintenix-area-metadata-"));
process.env.MAINTENIX_AREA_METADATA_FILE = path.join(tmp, "area-metadata.json");

const {
  listAreaMetadata,
  getAreaMetadata,
  ensurePendingAreaMetadata,
  configureAreaMetadata
} = require("../lib/areaMetadata");
const { resolveSectionForArea } = require("../lib/reportStorage");

const emptyLoaded = {
  data: { sections: {} },
  direct: {},
  normalized: {},
  records: []
};

test("area metadata: pending records do not override report mapping", () => {
  const actor = {
    id: "user-1",
    email: "user@example.test",
    name: "Area Creator"
  };

  const first = ensurePendingAreaMetadata("New Substation F895-G1234", actor);
  const duplicate = ensurePendingAreaMetadata("  new   substation f895-g1234  ", actor);

  assert.equal(first.created, true);
  assert.equal(first.record.status, "PENDING");
  assert.equal(duplicate.created, false);
  assert.equal(listAreaMetadata().length, 1);

  const resolution = resolveSectionForArea("New Substation F895-G1234", {
    loaded: emptyLoaded
  });
  assert.equal(resolution.matched, false);
  assert.equal(resolution.section, "Unmapped");
});

test("area metadata: configured runtime metadata takes precedence", () => {
  const admin = {
    id: "admin-1",
    email: "admin@example.test",
    name: "Admin User"
  };

  const configured = configureAreaMetadata(
    "New Substation F895-G1234",
    {
      section: "Section B",
      baseArea: "New Substation",
      first: "895",
      second: "1234"
    },
    admin
  );

  assert.equal(configured.status, "CONFIGURED");
  assert.equal(configured.section, "Section B");
  assert.equal(configured.first, "895");
  assert.equal(configured.second, "1234");

  const stored = getAreaMetadata("NEW SUBSTATION F895-G1234");
  assert.equal(stored.section, "Section B");
  assert.equal(stored.updatedBy.email, "admin@example.test");

  const resolution = resolveSectionForArea("New Substation F895-G1234", {
    loaded: {
      data: { sections: { "Section A1": [] } },
      direct: { "New Substation F895-G1234": "Section A1" },
      normalized: { "new substation f895-g1234": "Section A1" },
      records: []
    }
  });

  assert.equal(resolution.matched, true);
  assert.equal(resolution.reason, "runtime_admin");
  assert.equal(resolution.section, "Section B");
});

test("area metadata: F and G code values may remain blank", () => {
  const configured = configureAreaMetadata(
    "Server Room Without Codes",
    {
      section: "IIT & IT",
      baseArea: "Server Room Without Codes",
      first: "",
      second: ""
    },
    { id: "admin-1", email: "admin@example.test", name: "Admin User" }
  );

  assert.equal(configured.status, "CONFIGURED");
  assert.equal(configured.first, "");
  assert.equal(configured.second, "");
});
