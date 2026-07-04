# 学习计划功能设计

## 目标

新增一个“学习计划”页面，用来管理教材、讲义或课程的章节进度。例如创建计划“李林高数辅导讲义”，在计划内添加“函数、极限与连续”“导数与微分”等章节条目，并通过勾选完成状态查看整体进度。

页面需要支持：

- 新增、编辑、删除学习计划。
- 在每个计划下新增、编辑、删除章节条目。
- 勾选或取消勾选章节完成状态。
- 显示每个计划的完成数量、总数、百分比和进度条。
- 支持章节条目拖拽排序，并提供上移、下移按钮作为非拖拽操作方式。

## 范围

- 新增顶层页面 `static/study.html`，接入现有顶部导航。
- 新增 Worker API、D1 迁移、本地 `app.py` 存储逻辑和前端交互。
- 延续当前原生 HTML/CSS/JS 架构，不引入前端框架或构建步骤。
- 首版仅支持一层章节条目，不做多级目录、计划截止日期、学习时长统计或提醒。
- 删除计划会删除该计划下所有章节条目。

## 数据模型

新增 `study_plans` 表：

- `id`: 主键。
- `title`: 计划名称，必填，去除首尾空白后不能为空。
- `created_at`: 创建时间。
- `updated_at`: 更新时间。

新增 `study_plan_items` 表：

- `id`: 主键。
- `plan_id`: 所属计划 ID。
- `title`: 章节条目名称，必填，去除首尾空白后不能为空。
- `status`: `pending` 或 `completed`，默认 `pending`。
- `position`: 同一计划内的排序值，越小越靠前。
- `created_at`: 创建时间。
- `updated_at`: 更新时间。
- `completed_at`: 完成时间，未完成时为空。

索引：

- `idx_study_plan_items_plan_position` 用于按计划读取章节条目。
- `idx_study_plan_items_plan_status` 用于统计完成进度。

## 页面结构

顶部导航新增“学习计划”，与待办、倒数日、笔记同级。学习计划页沿用当前 `shell`、`panel`、`composer`、`list-panel` 风格，保持个人办公工具的安静、密集布局。

页面包含：

- 新增计划表单：输入计划名称并提交。
- 计划列表：每个计划显示标题、完成数量、总数、百分比和进度条。
- 计划操作：编辑计划名称、删除计划。
- 章节列表：展开在计划卡片内，按 `position` 排序。
- 章节操作：勾选完成、编辑名称、删除、拖拽排序、上移、下移。
- 空状态：无计划时显示“暂无学习计划。”；计划内无条目时显示“暂无章节。”。

## 交互规则

新增计划后立即出现在列表顶部，首版按创建时间倒序展示计划。

新增章节时，`position` 使用当前计划内最大排序值加一。章节拖拽结束后，前端提交新的 ID 顺序；服务端按提交顺序重新写入连续 `position`。

上移、下移按钮使用同一个重排 API：前端交换相邻条目的顺序后提交完整顺序。第一个条目的上移按钮禁用，最后一个条目的下移按钮禁用。

勾选完成时：

- `pending` 切换为 `completed`，写入 `completed_at`。
- `completed` 切换为 `pending`，清空 `completed_at`。
- 前端立即更新进度，接口失败时回滚。

进度计算：

- 总数为 0 时百分比显示 `0%`，进度条宽度为 0。
- 总数大于 0 时，百分比为 `completed / total * 100` 四舍五入后的整数。

删除计划前弹出确认，文案明确会同时删除章节。删除章节前也弹出确认。

## API

新增端点：

- `GET /api/study-plans`: 返回计划列表及每个计划的章节条目。
- `POST /api/study-plans`: 创建计划。
- `PATCH /api/study-plans/{id}`: 修改计划名称。
- `DELETE /api/study-plans/{id}`: 删除计划及其章节。
- `POST /api/study-plans/{id}/items`: 创建章节条目。
- `PATCH /api/study-plan-items/{id}`: 修改章节名称或完成状态。
- `DELETE /api/study-plan-items/{id}`: 删除章节条目。
- `POST /api/study-plans/{id}/items/reorder`: 提交该计划下章节 ID 的完整排序。

所有端点沿用现有登录保护和 JSON 错误格式。

`GET /api/study-plans` 返回结构：

```json
{
  "plans": [
    {
      "id": 1,
      "title": "李林高数辅导讲义",
      "created_at": "2026-07-04T10:00:00",
      "updated_at": "2026-07-04T10:00:00",
      "total_items": 2,
      "completed_items": 1,
      "progress_percent": 50,
      "items": [
        {
          "id": 1,
          "plan_id": 1,
          "title": "函数、极限与连续",
          "status": "completed",
          "position": 1,
          "created_at": "2026-07-04T10:01:00",
          "updated_at": "2026-07-04T10:02:00",
          "completed_at": "2026-07-04T10:02:00"
        }
      ]
    }
  ]
}
```

## 验证

测试覆盖：

- Worker API：计划和章节的创建、编辑、删除、完成状态切换、拖拽重排持久化。
- 本地 `app.py` 存储：数据模型、进度计算、删除计划级联删除章节。
- 前端结构：新增学习计划页面、导航入口、表单、进度条、拖拽和上移下移控件。
- 迁移：新增表和索引存在。

实现完成后运行：

- `npm test`
- `python3.11 -m unittest discover -s tests`
- `node --check static/app.js`
- `node --check src/worker.js`
- `python3.11 -m py_compile app.py remind.py`
