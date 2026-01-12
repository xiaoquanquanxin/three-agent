import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

interface ThreeSceneProps {
  shapes: any[]
}

function ThreeScene({ shapes }: ThreeSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const shapesMapRef = useRef<Map<string, THREE.Mesh>>(new Map())

  // 初始化 Three.js 场景
  useEffect(() => {
    if (!mountRef.current) return

    const container = mountRef.current
    const width = container.clientWidth
    const height = container.clientHeight

    // 创建场景
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a1a)
    sceneRef.current = scene

    // 创建相机（3D 透视相机）
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000)
    camera.position.set(0, 30, 30)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    // 创建渲染器
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(window.devicePixelRatio)
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // 添加 OrbitControls（支持 3D 旋转、缩放）
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.target.set(0, 0, 0)
    controlsRef.current = controls

    // 添加网格地面
    const gridHelper = new THREE.GridHelper(50, 50, 0xaaaaaa, 0x555555)
    scene.add(gridHelper)

    // 添加坐标轴辅助
    const axesHelper = new THREE.AxesHelper(20)
    scene.add(axesHelper)

    // 添加环境光
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)

    // 添加方向光
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(10, 20, 10)
    scene.add(directionalLight)

    // 渲染循环
    function animate() {
      requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // 处理窗口大小变化
    function handleResize() {
      if (!mountRef.current) return
      const newWidth = mountRef.current.clientWidth
      const newHeight = mountRef.current.clientHeight
      camera.aspect = newWidth / newHeight
      camera.updateProjectionMatrix()
      renderer.setSize(newWidth, newHeight)
    }
    window.addEventListener('resize', handleResize)

    // 清理
    return () => {
      window.removeEventListener('resize', handleResize)
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement)
      }
      renderer.dispose()
    }
  }, [])

  // 更新场景中的形状
  useEffect(() => {
    if (!sceneRef.current) return

    console.log('🎨 ThreeScene: 更新场景，shapes:', shapes)

    const scene = sceneRef.current
    const shapesMap = shapesMapRef.current

    // 移除不存在的形状
    const currentIds = new Set(shapes.map((s) => s.id))
    shapesMap.forEach((mesh, id) => {
      if (!currentIds.has(id)) {
        scene.remove(mesh)
        mesh.geometry.dispose()
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose())
        } else {
          mesh.material.dispose()
        }
        shapesMap.delete(id)
      }
    })

    // 添加或更新形状
    shapes.forEach((shape) => {
      if (!shapesMap.has(shape.id)) {
        console.log('➕ 创建新形状:', shape.type, shape.id)
        const mesh = createShapeMesh(shape)
        if (mesh) {
          console.log('✅ Mesh 创建成功，添加到场景')
          scene.add(mesh)
          shapesMap.set(shape.id, mesh)
        } else {
          console.error('❌ Mesh 创建失败')
        }
      }
    })
  }, [shapes])

  return <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
}

/**
 * 根据形状数据创建 Three.js Mesh
 */
function createShapeMesh(shape: any): THREE.Mesh | null {
  console.log('🔨 createShapeMesh:', {
    type: shape.type,
    hasVertexList: !!shape.vertexList,
    position_x: shape.position_x,
    position_z: shape.position_z,
  })

  const { type, vertexList, position_x, position_z } = shape

  let geometry: THREE.BufferGeometry | null = null
  const material = new THREE.MeshStandardMaterial({
    color: 0x00ff88,
    side: THREE.DoubleSide,
  })

  if (type === 'square' && Array.isArray(vertexList)) {
    // 正方形：使用 ShapeGeometry
    const shapeGeom = new THREE.Shape()
    const firstVertex = vertexList[0]
    shapeGeom.moveTo(firstVertex[0], firstVertex[2])
    for (let i = 1; i < vertexList.length; i++) {
      shapeGeom.lineTo(vertexList[i][0], vertexList[i][2])
    }
    shapeGeom.lineTo(firstVertex[0], firstVertex[2])
    geometry = new THREE.ShapeGeometry(shapeGeom)
  } else if (type === 'circle' && vertexList.center) {
    // 圆形：使用 CircleGeometry
    const radius = vertexList.radius || 5
    geometry = new THREE.CircleGeometry(radius, 32)
  } else if (type === 'triangle' && Array.isArray(vertexList)) {
    // 三角形：使用 ShapeGeometry
    const shapeGeom = new THREE.Shape()
    shapeGeom.moveTo(vertexList[0][0], vertexList[0][2])
    shapeGeom.lineTo(vertexList[1][0], vertexList[1][2])
    shapeGeom.lineTo(vertexList[2][0], vertexList[2][2])
    shapeGeom.lineTo(vertexList[0][0], vertexList[0][2])
    geometry = new THREE.ShapeGeometry(shapeGeom)
  }

  if (!geometry) return null

  const mesh = new THREE.Mesh(geometry, material)

  // 旋转到 XZ 平面（平放在地面上）
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(position_x, 0.1, position_z)

  // 存储 ID 到 userData
  mesh.userData.id = shape.id
  mesh.userData.type = type

  return mesh
}

export default ThreeScene
