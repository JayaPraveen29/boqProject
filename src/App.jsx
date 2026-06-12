import { Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/sidebar/sidebar'
import EntryPage from './pages/EntryPage/EntryPage'
import ViewData from './pages/ViewData/ViewData'
import AbstractReport from './pages/AbstractReport/AbstractReport'
import './App.css'

function App() {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/entry" />} />
          <Route path="/entry" element={<EntryPage />} />
          <Route path="/view-data" element={<ViewData />} />
          <Route path="/abstract-report" element={<AbstractReport />} />
        </Routes>
      </div>
    </div>
  )
}

export default App