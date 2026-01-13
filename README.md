### 需求
* 技术栈 
  * nodejs + typescript + langgraph + supervisor agent + threejs + react + mysql
  * 后期：mcp
* 业务：
  * 左侧是 threejs scene，右侧是 agent 对话框
    * 用户的输入：
      * 用户说：“绘制一个正方形，边长是 x，位置是 x\y\z（可选）”
        * llm 分析得知这是要画一个正方形，然后在数据库中增加一个正方形数据，包括边长、id、位置（考虑到拓展性，可以是四个顶点的位置）
      * 用户说：“绘制一个圆形，半径是 r，位置是 x\y\z（可选）”
        * llm 分析得知这是要绘制一个圆，然后在数据库中增加一个圆形数据，包括半径、圆心
      * 用户说：“绘制一个三角形，xxxx略”
        * llm 分析得知这是要绘制一个三角形，然后在数据库中增加一个三角形，包括三个顶点的坐标
      * 用户说：“把坐标 (10, 0, 10) 附近的那个三角形删掉。”
        * 这是关键！ 
        * 第一步：意图识别与数据索取（感知阶段）
          * 这一步的目的是**“缩小包围圈”**。Agent 就像一个戴着眼罩的人，它需要通过询问前端来获取“视觉信息”。 
          * 用户说：“把坐标 (10, 0, 10) 附近的那个三角形删掉。”
          * LLM 思考：我不知道坐标 (10, 0, 10) 有什么。但我有一个工具叫 getNearbyObjects。
          * LLM 发出请求（给前端）：{"tool": "getNearbyObjects", "params": {"x": 10, "y": 0, "z": 10}}。
          * 前端反馈：前端在 Three.js 场景里执行空间搜索，发现那里有一个 ID 为 tri_456 的蓝色三角形，回复给 LLM。
        * 第二步：逻辑确认与指令下达（决策阶段）
          * 这一步是**“精准打击”**。Agent 拿到了关键证据，开始执行真正的 3D 操作。
          * LLM 思考：现在我知道了，坐标 (10, 0, 10) 附近只有一个三角形，ID 是 tri_456。
          * LLM 发出指令：{"action": "delete", "targetId": "tri_456"}。
          * 数据库里的数据更新
          * 前端执行：const obj = scene.getObjectByProperty('uuid', 'tri_456'); scene.remove(obj);。
      * 用户说：“修改上一个正方形的边长，改为 xx” 
        * 这是关键！
        * 第一步：意图识别与数据索取（感知阶段）
          * llm 要先知道用户所说的“上一个正方形”是哪个对象，这里需要有一个意图分析，因为场景中可能有 1000 个对象，让 llm 去读取这些数据太过于浪费 token 了
          * llm 发出请求（给前端）：{"tool":"getLastSquare"}
          * 前端反馈：根据所有正方形的 createdAt，得知上一个正方向是哪个。（这里，getLastSquare 可以是其他方法，比如用户说倒数第三个创建的正方形，那么就可以传一个参数比如 -3，然后前端在这个方法里排序，得到倒数第三个正方形）
        * 第二步：逻辑确认与指令下达（决策阶段）
          * llm 根据 getLastSquare 得到的这个 square_id，寻找修改正方形边长得到 tool，然后修改它的边长
          * llm 发出指令：{"action": "modification", "targetId": "square_id", 顶点坐标或边长信息 }。
          * 数据库里的数据更新
          * 前段执行修改
      * 用户说：“列举场景中的对象”
        * 这里和之前的所有需求不同，所以这里是要用另一个 agent，也就是说，要有一个 supervisor agent 分析用户的需求需要用哪个 agent 去做
        * llm 分析后发出请求（给前端）{"tool":"showSquare" 或 "showAllTrangle"... }


### 启动命令

**后端（Langgraph）**
```bash
cd backend
npx @langchain/langgraph-cli dev
```

**前端**
```bash
cd frontend
npm run dev
```
