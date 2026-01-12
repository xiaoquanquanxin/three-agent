import { useState, useRef } from 'react'
import ThreeScene, { ThreeSceneRef } from './components/ThreeScene'
import ChatPanel from './components/ChatPanel'
import './App.css'

function App() {
  const [shapes, setShapes] = useState<any[]>([])
  const sceneRef = useRef<ThreeSceneRef>(null)

  return (
    <div className="app">
      {/* 左侧：Three.js 场景 */}
      <div className="scene-container">
        <ThreeScene ref={sceneRef} shapes={shapes} />
      </div>

      {/* 右侧：对话框 */}
      <div className="chat-container">
        <ChatPanel onShapeUpdate={setShapes} sceneRef={sceneRef} />
      </div>
    </div>
  )
}

export default App
