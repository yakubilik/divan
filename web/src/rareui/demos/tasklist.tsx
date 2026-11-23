"use client";

import { TaskList } from "@/components/ui/task-list";

const TASKS = [
  { id: "ship", label: "Ship a new component to the registry", done: true },
  { id: "preview", label: "Record a preview for the gallery" },
  { id: "star", label: "Star Rare UI" },
];

export default function TaskListPage() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <TaskList defaultTasks={TASKS} />
    </div>
  );
}
