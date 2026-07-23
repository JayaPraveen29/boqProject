import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import './sidebar.css'

export default function Sidebar() {
  const [isOpen, setIsOpen] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)

  const toggleSidebar = () => setIsOpen(!isOpen)
  const closeSidebar = () => setIsOpen(false)
  const toggleReports = () => setReportsOpen(!reportsOpen)

  return (
    <>
      {/* Hamburger button - mobile only */}
      <button className="hamburger-btn" onClick={toggleSidebar}>
        {isOpen ? '✕' : '☰'}
      </button>

      {/* Overlay - mobile only */}
      {isOpen && <div className="sidebar-overlay" onClick={closeSidebar} />}

      {/* Sidebar */}
      <div className={`sidebar ${isOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <h2>SIEC-BOQ</h2>
        </div>

        <nav className="sidebar-nav">
          <NavLink
            to="/entry"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            onClick={closeSidebar}
          >
            📝 Entry Page
          </NavLink>

          <NavLink
            to="/view-data"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            onClick={closeSidebar}
          >
            📋 View Data
          </NavLink>

          {/* Reports Dropdown */}
          <div className="nav-dropdown">
            <button
              className={`dropdown-toggle ${reportsOpen ? 'open' : ''}`}
              onClick={toggleReports}
            >
              <span>📊 Reports</span>
              <span className={`arrow ${reportsOpen ? 'arrow-up' : 'arrow-down'}`}>▾</span>
            </button>

            {reportsOpen && (
              <div className="dropdown-menu">
                <NavLink
                  to="/abstract-report"
                  className={({ isActive }) => `dropdown-link ${isActive ? 'active' : ''}`}
                  onClick={closeSidebar}
                >
                  📄 Abstract Report
                </NavLink>

                <NavLink
                  to="/single-section-report"
                  className={({ isActive }) => `dropdown-link ${isActive ? 'active' : ''}`}
                  onClick={closeSidebar}
                >
                  📐 Single Section Report
                </NavLink>
                <NavLink
                  to="/sectional-weights-report"
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  onClick={closeSidebar}
                >
                  Sectional Weights Report
                </NavLink>
              </div>
            )}
          </div>

          

          <NavLink
            to="/data-manager"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            onClick={closeSidebar}
          >
            🗂️ Data Manager
          </NavLink>

        </nav>
      </div>
    </>
  )
}