import React, { useMemo, useState } from "react";
import SimpleBar from "simplebar-react";
import { useLocation, Link } from "react-router-dom";
import { CSSTransition } from "react-transition-group";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faImage, faBoxes, faChartPie, faCog, faFileAlt, faSignOutAlt, faTimes, faClipboardList, faPhoneSquare, faCalendarAlt} from "@fortawesome/free-solid-svg-icons";
import { Nav, Badge, Image, Button, Navbar } from "@themesberg/react-bootstrap";

import { Routes } from "../routes";
import ReactHero from "../assets/img/maintenix_foreground.svg";
import ProfileFallback from "../assets/img/team/profile-picture-3.jpg";

function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export default function Sidebar(props = {}) {
  const location = useLocation();
  const { pathname } = location;

  const [show, setShow] = useState(false);
  const showClass = show ? "show" : "";

  const onCollapse = () => setShow(!show);

  const authUser = safeJsonParse(localStorage.getItem("authUser") || "null", null);
  const displayName = authUser?.name || authUser?.email || "User";

  // ✅ Use uploaded profile pic if present
  const avatarSrc = useMemo(() => {
    const url = String(authUser?.photoUrl || "").trim();
    return url ? url : ProfileFallback;
  }, [authUser]);

  function handleLogout() {
    localStorage.removeItem("authToken");
    localStorage.removeItem("authUser");

    // ✅ update Navbar instantly (same tab)
    window.dispatchEvent(new Event("authUserUpdated"));

    setShow(false);
    window.location.hash = Routes.Signin.path; // HashRouter-safe
  }

  const NavItem = (p) => {
    const { title, link, external, target, icon, image, badgeText, badgeBg = "secondary", badgeColor = "primary" } = p;
    const classNames = badgeText ? "d-flex justify-content-start align-items-center justify-content-between" : "";
    const navItemClassName = link === pathname ? "active" : "";
    const linkProps = external ? { href: link } : { as: Link, to: link };

    return (
      <Nav.Item className={navItemClassName} onClick={() => setShow(false)}>
        <Nav.Link {...linkProps} target={target} className={classNames}>
          <span>
            {icon ? (
              <span className="sidebar-icon">
                <FontAwesomeIcon icon={icon} />{" "}
              </span>
            ) : null}
            {image ? <Image src={image} width={20} height={20} className="sidebar-icon svg-icon" /> : null}
            <span className="sidebar-text">{title}</span>
          </span>
          {badgeText ? (
            <Badge pill bg={badgeBg} text={badgeColor} className="badge-md notification-count ms-2">
              {badgeText}
            </Badge>
          ) : null}
        </Nav.Link>
      </Nav.Item>
    );
  };

  return (
    <>
      <Navbar expand={false} collapseOnSelect variant="dark" className="navbar-theme-primary px-4 d-md-none">
        <Navbar.Brand className="me-lg-5" as={Link} to={Routes.DashboardOverview.path}>
          <Image src={ReactHero} className="navbar-brand-light" />
        </Navbar.Brand>
        <Navbar.Toggle as={Button} aria-controls="main-navbar" onClick={onCollapse}>
          <span className="navbar-toggler-icon" />
        </Navbar.Toggle>
      </Navbar>

      <CSSTransition timeout={300} in={show} classNames="sidebar-transition">
        <SimpleBar className={`collapse ${showClass} sidebar d-md-block bg-primary text-white`}>
          <div className="sidebar-inner px-4 pt-3">
            {/* Mobile user card */}
            <div className="user-card d-flex d-md-none align-items-center justify-content-between justify-content-md-center pb-4">
              <div className="d-flex align-items-center">
                <div className="user-avatar lg-avatar me-4">
                  <Image
                    src={avatarSrc}
                    className="card-img-top rounded-circle border-white"
                    onError={(e) => {
                      e.currentTarget.src = ProfileFallback;
                    }}
                  />
                </div>
                <div className="d-block">
                  <h6>Hi, {displayName}</h6>

                  <Button variant="secondary" size="xs" className="text-dark" onClick={handleLogout}>
                    <FontAwesomeIcon icon={faSignOutAlt} className="me-2" /> Sign Out
                  </Button>
                </div>
              </div>

              <Nav.Link className="collapse-close d-md-none" onClick={onCollapse}>
                <FontAwesomeIcon icon={faTimes} />
              </Nav.Link>
            </div>

            <Nav className="flex-column pt-3 pt-md-0">
              <NavItem title="Maintenix Server" link={Routes.Presentation.path} image={ReactHero} />
              <NavItem title="Overview" link={Routes.DashboardOverview.path} icon={faChartPie} />
              <NavItem title="Servicing" link={Routes.Servicing.path} icon={faClipboardList} />
              <NavItem title="Call Out" link={Routes.CallOut.path} icon={faPhoneSquare} />
              <NavItem title="Standby" link={Routes.Standby.path} icon={faCalendarAlt} />
              <NavItem title="Reports" link={Routes.Reports.path} icon={faFileAlt} />
              <NavItem title="Pictures" link={Routes.Pictures.path} icon={faImage} />
              <NavItem title="Stock Control" link={Routes.StockControl.path} icon={faBoxes} />
              <NavItem title="Settings" icon={faCog} link={Routes.Settings.path} />
            </Nav>
          </div>
        </SimpleBar>
      </CSSTransition>
    </>
  );
}
