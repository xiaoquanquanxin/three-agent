// App.jsx
import {useState, useRef, useEffect} from "react";
import {Client} from "@langchain/langgraph-sdk";
import * as THREE from "three";

const client = new Client({
  apiUrl: "https://your-deployment.ai.langgraph.net"
});

export default function ThreeAgent() {
  const [threadId, setThreadId] = useState();
  const [messages, setMessages] = useState([]);
  const [interrupt, setInterrupt] = useState(null);
  const sceneRef = useRef();
  const scene = useRef(new THREE.Scene());

  // 初始化 Three.js 场景（10000 个圆）
  useEffect(() => {
    // 添加 10000 个随机圆形
    for (let i = 0; i < 10000; i++) {
      const geometry = new THREE.CircleGeometry(0.5);
      const material = new THREE.MeshBasicMaterial({color: 0x00ff00});
      const circle = new THREE.Mesh(geometry, material);
      circle.position.set(
        (Math.random() - 0.5) * 100,
        (Math.random() - 0.5) * 100,
        0
      );
      scene.current.add(circle);
      sceneRef.current.objects.push(circle);
    }
  }, []);

  // 前端 findObject 方法
  const findNearestCircle = (position) => {
    let nearest = null;
    let minDist = Infinity;

    sceneRef.current.objects.forEach(obj => {
      if (obj.geometry.type === "CircleGeometry") {
        const dist = obj.position.distanceTo(new THREE.Vector3(...position));
        if (dist < minDist) {
          minDist = dist;
          nearest = obj;
        }
      }
    });

    return {
      id: nearest.uuid,
      position: nearest.position.toArray(),
      distance: minDist
    };
  };

  // 发送消息
  const sendMessage = async (content) => {
    if (!threadId) {
      const thread = await client.threads.create();
      setThreadId(thread.thread_id);
    }

    const run = await client.runs.create(threadId, "your-agent", {
      input: {messages: [{role: "human", content}]}
    });

    // Streaming 处理
    for await (const chunk of client.runs.stream(threadId, run.run_id)) {
      if (chunk.__interrupt__) {
        setInterrupt(chunk.__interrupt__[0].value);
        return;  // 暂停等待用户交互
      }

      // 更新消息
      setMessages(prev => [...prev, chunk]);
    }
  };

  // 处理 interrupt
  const handleInterrupt = async () => {
    if (!interrupt) return;

    if (interrupt.action === "findObject") {
      const result = findNearestCircle(interrupt.params.position);

      // 高亮找到的对象
      sceneRef.current.objects.forEach(obj => {
        obj.material.color.setHex(0x00ff00);
      });
      const target = sceneRef.current.objects.find(o => o.uuid === result.id);
      target.material.color.setHex(0xff0000);  // 红色高亮

      // 恢复 agent 执行
      await client.runs.wait(threadId, "your-agent", {
        command: {resume: {foundObject: result}}
      });

      setInterrupt(null);
    }
  };

  return (
    <div style={{display: "flex"}}>
      {/* Three.js 场景 */}
      <div ref={sceneRef} style={{flex: 1}}>
        {/* Canvas */}
      </div>

      {/* 聊天界面 */}
      <div style={{width: 400, padding: 20}}>
        <div className="messages">
          {messages.map(m => (
            <div key={m.id}>{m.content}</div>
          ))}
          {interrupt && (
            <div className="interrupt">
              <pre>{JSON.stringify(interrupt, null, 2)}</pre>
              <button onClick={handleInterrupt}>执行 {interrupt.action}</button>
            </div>
          )}
        </div>

        <input
          placeholder="描述你的操作..."
          onKeyDown={e => {
            if (e.key === "Enter") {
              sendMessage(e.target.value);
              e.target.value = "";
            }
          }}
        />
      </div>
    </div>
  );
}