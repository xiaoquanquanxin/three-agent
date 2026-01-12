import { useState } from 'react'
import ThreeScene from './components/ThreeScene'
import ChatPanel from './components/ChatPanel'
import './App.css'

function App() {
  const [shapes, setShapes] = useState<any[]>([])

  return (
    <div className="app">
      {/* 左侧：Three.js 场景 */}
      <div className="scene-container">
        <ThreeScene shapes={shapes} />
      </div>

      {/* 右侧：对话框 */}
      <div className="chat-container">
        <ChatPanel onShapeUpdate={setShapes} />
      </div>
    </div>
  )
}

export default App
