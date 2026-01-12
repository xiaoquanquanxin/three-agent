import { useState } from 'react'
import ThreeScene from './components/ThreeScene'
import ChatPanel from './components/ChatPanel'
import './App.css'

function App() {
  const [shapes, setShapes] = useState<any[]>([])

  // 处理来自后端的响应，更新场景
  const handleShapeUpdate = (newShapes: any[]) => {
    setShapes(newShapes)
  }

  return (
    <div className="app">
      {/* 左侧：Three.js 场景 */}
      <div className="scene-container">
        <ThreeScene shapes={shapes} />
      </div>

      {/* 右侧：对话框 */}
      <div className="chat-container">
        <ChatPanel onShapeUpdate={handleShapeUpdate} />
      </div>
    </div>
  )
}

export default App
