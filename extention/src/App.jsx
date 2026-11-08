import { useState, useEffect } from 'react'
import './App.css'

export default function App() {
  const [tabs, setTabs] = useState([])

  useEffect(() => {
    // If running inside Chrome extension
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      chrome.tabs.query({ currentWindow: true }).then((allTabs) => {
        setTabs(allTabs)
      })
    }
  }, [])

  return (
      <div style={{ width: 320, padding: 12, fontFamily: 'sans-serif' }}>
        <h3 style={{ margin: '0 0 10px 0' }}>Open Tabs ({tabs.length})</h3>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {tabs.map((tab) => (
              <li
                  key={tab.id}
                  style={{
                    padding: '6px 0',
                    borderBottom: '1px solid #eee',
                    fontSize: 13,
                  }}
              >
                <div
                    style={{
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                >
                  {tab.title || 'Untitled'}
                </div>
                <div
                    style={{
                      color: '#2563eb',
                      fontSize: 11,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                >
                  {tab.url}
                </div>
              </li>
          ))}
        </ul>
      </div>
  )
}