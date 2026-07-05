import React from "react";

import type { SlotKey, TaskState, TaskStatus } from "../../types";
import type { TaskSectionItem } from "../../hooks/useTasks";
import TaskSection from "./TaskSection";

type Props = {
  styles: Record<string, any>;
  tr: (key: string) => string;
  getSlotLabel: (slotKey: SlotKey) => string;
  sections: TaskSectionItem[];
  activeTaskId: string | null;
  noTagLabel: string;
  untitledLabel: string;
  statusLabel: Record<TaskStatus, string>;
  statusPalette: Record<TaskStatus, { bar: string; badgeBg: string; badgeText: string }>;
  selectionMode: boolean;
  selectedSet: Set<string>;
  activeExpandedBySlot: Record<SlotKey, boolean>;
  completedExpandedBySlot: Record<SlotKey, boolean>;
  completedTimeByTaskId: Map<string, string>;
  openSwipeTaskId: string | null;
  onToggleActive: (slotKey: SlotKey) => void;
  onToggleCompleted: (slotKey: SlotKey) => void;
  onAddTask: (slotKey: SlotKey) => void;
  onTaskPress: (slotKey: SlotKey, task: TaskState) => void;
  onToggleSelection: (taskId: string) => void;
  onOpenSwipe: (taskId: string) => void;
  onCloseSwipe: (taskId: string) => void;
  onMove: (slotKey: SlotKey, taskId: string) => void;
  onArchive: (slotKey: SlotKey, taskId: string) => void;
  onDelete: (taskId: string) => void;
  onStart: (slotKey: SlotKey, taskId: string) => void;
  onPause: (slotKey: SlotKey, taskId: string) => void;
  onDone: (slotKey: SlotKey, taskId: string) => void;
};

export type TaskListProps = Props;

const TaskList = (props: Props) => {
  return (
    <>
      {props.sections.map((section) => (
        <TaskSection
          key={section.slotKey}
          {...props}
          section={section}
          activeExpanded={props.activeExpandedBySlot[section.slotKey]}
          completedExpanded={props.completedExpandedBySlot[section.slotKey]}
        />
      ))}
    </>
  );
};

export default TaskList;
