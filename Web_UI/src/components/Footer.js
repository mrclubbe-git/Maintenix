import React from "react";
import moment from "moment-timezone";
import { Row, Col, OverlayTrigger, Tooltip } from "@themesberg/react-bootstrap";

// ✅ Version display
import { APP_VERSION, APP_GIT_SHA, APP_BUILD_TIME } from "../appVersion";

export default () => {
  const currentYear = moment().get("year");

  const versionLabel = `v${APP_VERSION}${APP_GIT_SHA ? ` (${APP_GIT_SHA})` : ""}`;
  const versionTooltip = APP_BUILD_TIME ? `Build: ${APP_BUILD_TIME}` : "";

  return (
    <footer className="footer section py-5">
      <Row>
        <Col xs={12} lg={6} className="mb-4 mb-lg-0">
          <p className="mb-0 text-center text-xl-left">
            Copyright © {`${currentYear} `}
            <span className="text-blue text-decoration-none fw-normal">
              Maintenix
            </span>
          </p>
        </Col>

        <Col xs={12} lg={6}>
          <p className="mb-0 text-center text-xl-right text-muted">
            App Version{" "}
            <OverlayTrigger
              placement="top"
              trigger={["hover", "focus"]}
              overlay={<Tooltip>{versionTooltip || versionLabel}</Tooltip>}
            >
              <span className="ms-2">{versionLabel}</span>
            </OverlayTrigger>
          </p>
        </Col>
      </Row>
    </footer>
  );
};
