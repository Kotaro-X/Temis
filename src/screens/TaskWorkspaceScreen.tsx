import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import PrivateProjectTaskItem from "../components/private-project/PrivateProjectTaskItem";
import TaskArchiveScreen from "./TaskArchiveScreen";
import TaskDetailScreen from "./TaskDetailScreen";
import TaskLogScreen from "./TaskLogScreen";
import TaskScreen from "./TaskScreen";
import TimerBar from "../components/tasks/TimerBar";
import type { Suggestion } from "../features/routineSuggestions";
import { useTaskWorkspace } from "../context/TaskWorkspaceContext";
import { getSlotLabel, type AppLanguage } from "../i18n";
import type { TaskWorkspaceScreenKey } from "../types/appNavigation";
import styles from "../styles/workspaceSharedStyles";
import type { SlotKey, Tag, TaskState, TaskStatus, TimeBoxSchedule } from "../types";
import { SLOT_KEYS } from "../types";
import { subscribeProjectTasks, deleteProjectTask, updateProjectTask, type MyProjectTask } from "../services/collaboration/collaborationService";
import { projectTaskOwner } from "../services/collaboration/projectTaskCore";
import { useCollaboration } from "../context/CollaborationContext";
import { getProjectTaskPrivateDate, getProjectTaskPrivateSlot, toLocalDateString } from "../utils/projectTaskPlacement";

type Props = {
  visible: boolean;
  insetsTop: number;
  currentScreen: TaskWorkspaceScreenKey | null;
  onChangeScreen: (screen: TaskWorkspaceScreenKey) => void;
  selectedDate: string;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenMenu: () => void;
  onOpenDatePicker: () => void;
  tr: (key: string) => string;
  trf: (key: string, vars: Record<string, string | number>) => string;
  language: AppLanguage;
  noTagLabel: string;
  untitledLabel: string;
  statusLabel: Record<TaskStatus, string>;
  statusPalette: Record<
    TaskStatus,
    { bar: string; badgeBg: string; badgeText: string }
  >;
  tagOptions: Tag[];
  timeBoxSchedule: TimeBoxSchedule;
  onSearchToken: (keyword: string) => void;
  defaultContentPaddingTop: number;
  taskDetailContentPaddingTop: number;
  todayContentPaddingTop: number;
  footerPaddingBottom: number;
};

const buildExpandedState = () =>
  SLOT_KEYS.reduce(
    (acc, key) => {
      acc[key] = true;
      return acc;
    },
    {} as Record<SlotKey, boolean>,
  );

const emptyProjectTasksBySlot = () =>
  SLOT_KEYS.reduce(
    (items, slotKey) => {
      items[slotKey] = [];
      return items;
    },
    {} as Record<SlotKey, MyProjectTask[]>,
  );

const parseMinutes = (text: string) => {
  const cleaned = text.replace(/[^0-9]/g, "");
  if (cleaned.length === 0) {
    return 0;
  }
  const value = parseInt(cleaned, 10);
  return Number.isNaN(value) ? 0 : value;
};

const TaskWorkspaceScreen = ({
  visible,
  insetsTop,
  currentScreen,
  onChangeScreen,
  selectedDate,
  refreshing,
  onRefresh,
  onOpenMenu,
  onOpenDatePicker,
  tr,
  trf,
  language,
  noTagLabel,
  untitledLabel,
  statusLabel,
  statusPalette,
  tagOptions,
  timeBoxSchedule,
  onSearchToken,
  defaultContentPaddingTop,
  taskDetailContentPaddingTop,
  todayContentPaddingTop,
  footerPaddingBottom,
}: Props) => {
  const [projectArchiveItems, setProjectArchiveItems] = useState<MyProjectTask[]>([]);
  const [projectTasksBySlot, setProjectTasksBySlot] = useState(emptyProjectTasksBySlot);
  const { profile, projects } = useCollaboration();
  const projectSession = useRef(0);
  const [projectReload, setProjectReload] = useState(0);
  const {
    todayState,
    activeTaskId,
    routineSuggestions,
    currentSlot,
    archivedTasks,
    todaySections,
    completedTimeByTaskId,
    inProgressInfo,
    selectionMode,
    selectedSet,
    updateTask,
    toggleTaskTag,
    addTask,
    addSuggestion,
    dismissSuggestion,
    deleteTask,
    deleteSelectedTasks,
    archiveTask,
    startTask,
    pauseTask,
    stopTask,
    focusTask,
    exitSelectionMode,
    toggleSelection,
    moveModalOpen,
    moveDateDraft,
    moveDateError,
    moveTargetSlotKey,
    setMoveDateDraft,
    setMoveTargetSlotKey,
    openMoveModal,
    openMoveSelectedModal,
    moveTask,
    closeMoveModal,
    shiftMoveDateDraft,
    applyMoveTask,
    restoreModalOpen,
    restoreDateDraft,
    restoreDateError,
    restoreTargetSlotKey,
    setRestoreDateDraft,
    setRestoreTargetSlotKey,
    openRestoreModal,
    closeRestoreModal,
    shiftRestoreDateDraft,
    applyRestoreTask,
    detailTaskInfo,
    openTaskDetail,
    closeTaskDetail,
    logState,
  } = useTaskWorkspace();

  const refreshProjectTasks = useCallback(() => setProjectReload(value => value + 1), []);

  useEffect(() => {
    const session = ++projectSession.current;
    setProjectTasksBySlot(emptyProjectTasksBySlot()); setProjectArchiveItems([]);
    if (!visible || (currentScreen !== "today" && currentScreen !== "archive") || !profile) return;
    const grouped = new Map<string, MyProjectTask[]>();
    const unsubscribers = projects.map(project => subscribeProjectTasks(project.id, tasks => {
      if (session !== projectSession.current) return;
      grouped.set(project.id, tasks.filter(task => (task.kind ?? "task") === "task" && projectTaskOwner(task) === profile.userId).map(task => ({ project, task })));
      setProjectArchiveItems([...grouped.values()].flat().filter(item => item.task.isArchived));
      const nextBySlot = emptyProjectTasksBySlot();
      for (const item of [...grouped.values()].flat()) {
        if (getProjectTaskPrivateDate(item.task) === selectedDate) nextBySlot[getProjectTaskPrivateSlot(item.task, timeBoxSchedule)].push(item);
      }
      setProjectTasksBySlot(nextBySlot);
    }, () => { if (session === projectSession.current) { grouped.delete(project.id); setProjectTasksBySlot(emptyProjectTasksBySlot()); } }));
    return () => { projectSession.current = session + 1; unsubscribers.forEach(unsubscribe => unsubscribe()); };
  }, [visible, currentScreen, profile, projects, selectedDate, timeBoxSchedule, projectReload]);
  const [newTaskId, setNewTaskId] = useState<string | null>(null);
  const [activeExpandedBySlot, setActiveExpandedBySlot] = useState<
    Record<SlotKey, boolean>
  >(buildExpandedState);
  const [completedExpandedBySlot, setCompletedExpandedBySlot] = useState<
    Record<SlotKey, boolean>
  >(buildExpandedState);

  useEffect(() => {
    if (!selectionMode || currentScreen !== "today") return;
    const existing = new Set(Object.values(projectTasksBySlot).flat().filter(item => !item.task.isArchived).map(item => `project:${item.task.id}`));
    for (const id of selectedSet) if (id.startsWith("project:") && !existing.has(id)) toggleSelection(id);
  }, [currentScreen, projectTasksBySlot, selectedSet, selectionMode, toggleSelection]);

  const taskListBaseProps = useMemo(
    () => ({
      styles,
      tr,
      getSlotLabel: (slotKey: SlotKey) => getSlotLabel(language, slotKey),
      sections: todaySections,
      activeTaskId,
      noTagLabel,
      untitledLabel,
      statusLabel,
      statusPalette,
      selectionMode,
      selectedSet,
      activeExpandedBySlot,
      completedExpandedBySlot,
      completedTimeByTaskId,
      onToggleActive: (slotKey: SlotKey) =>
        setActiveExpandedBySlot((prev) => ({
          ...prev,
          [slotKey]: !prev[slotKey],
        })),
      onToggleCompleted: (slotKey: SlotKey) =>
        setCompletedExpandedBySlot((prev) => ({
          ...prev,
          [slotKey]: !prev[slotKey],
        })),
      onAddTask: (slotKey: SlotKey) => {
        const created = addTask(slotKey);
        if (created) {
          setNewTaskId(created.id);
          focusTask(created.id);
          openTaskDetail(slotKey, created.id);
          onChangeScreen("taskDetail");
        }
      },
      onToggleSelection: toggleSelection,
      onStart: startTask,
      onPause: pauseTask,
      onDone: (slotKey: SlotKey, taskId: string) =>
        stopTask(slotKey, taskId, "completed"),
    }),
    [
      activeExpandedBySlot,
      activeTaskId,
      addTask,
      completedExpandedBySlot,
      completedTimeByTaskId,
      focusTask,
      language,
      noTagLabel,
      onChangeScreen,
      openTaskDetail,
      pauseTask,
      selectedSet,
      selectionMode,
      startTask,
      statusLabel,
      statusPalette,
      stopTask,
      styles,
      todaySections,
      toggleSelection,
      tr,
      untitledLabel,
    ],
  );

  const moveModalProps = useMemo(
    () => ({
      styles,
      visible: moveModalOpen,
      title: tr("modal.moveTask"),
      cancelLabel: tr("common.cancel"),
      confirmLabel: tr("task.move"),
      prevLabel: tr("date.prev"),
      nextLabel: tr("date.next"),
      dateDraft: moveDateDraft,
      onChangeDateDraft: setMoveDateDraft,
      dateError: moveDateError ? tr("validation.invalidDate") : null,
      slotOptions: SLOT_KEYS.map((slotKey) => ({
        key: slotKey,
        label: getSlotLabel(language, slotKey),
        active: moveTargetSlotKey === slotKey,
        onPress: () => setMoveTargetSlotKey(slotKey),
      })),
      onPrevDate: () => shiftMoveDateDraft(-1),
      onNextDate: () => shiftMoveDateDraft(1),
      onClose: closeMoveModal,
      onConfirm: () => {
        const parsed = new Date(`${moveDateDraft}T00:00:00`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(moveDateDraft) || Number.isNaN(parsed.getTime()) || toLocalDateString(parsed.getTime()) !== moveDateDraft) { void applyMoveTask(); return; }
        const sharedIds = [...selectedSet].filter(id => id.startsWith("project:"));
        void Promise.all(sharedIds.map(id => updateProjectTask(id.slice(8), { privateDate: moveDateDraft, privateSlotKey: moveTargetSlotKey })))
          .then(() => applyMoveTask()).catch(error => Alert.alert("移動できません", error.message));
      },
    }),
    [
      applyMoveTask,
      selectedSet,
      closeMoveModal,
      language,
      moveDateDraft,
      moveDateError,
      moveModalOpen,
      moveTargetSlotKey,
      setMoveDateDraft,
      setMoveTargetSlotKey,
      shiftMoveDateDraft,
      styles,
      tr,
    ],
  );

  const restoreModalProps = useMemo(
    () => ({
      styles,
      visible: restoreModalOpen,
      title: tr("modal.restoreTask"),
      cancelLabel: tr("common.cancel"),
      confirmLabel: tr("modal.restore"),
      dateLabel: tr("modal.date"),
      timeRangeLabel: tr("modal.timeRange"),
      prevLabel: tr("date.prev"),
      nextLabel: tr("date.next"),
      dateDraft: restoreDateDraft,
      onChangeDateDraft: setRestoreDateDraft,
      dateError: restoreDateError ? tr("validation.invalidDate") : null,
      slotOptions: SLOT_KEYS.map((slotKey) => {
        const range = timeBoxSchedule[slotKey];
        return {
          key: slotKey,
          label: `${getSlotLabel(language, slotKey)} ${range.start}-${range.end}`,
          active: restoreTargetSlotKey === slotKey,
          onPress: () => setRestoreTargetSlotKey(slotKey),
        };
      }),
      onPrevDate: () => shiftRestoreDateDraft(-1),
      onNextDate: () => shiftRestoreDateDraft(1),
      onClose: closeRestoreModal,
    }),
    [
      closeRestoreModal,
      language,
      restoreDateDraft,
      restoreDateError,
      restoreModalOpen,
      restoreTargetSlotKey,
      setRestoreDateDraft,
      setRestoreTargetSlotKey,
      shiftRestoreDateDraft,
      styles,
      timeBoxSchedule,
      tr,
    ],
  );

  const taskArchiveListBaseProps = useMemo(
    () => ({
      styles,
      tr,
      items: archivedTasks,
      getSlotLabel: (slotKey: SlotKey) => getSlotLabel(language, slotKey),
      statusLabel,
      untitledLabel,
    }),
    [archivedTasks, language, statusLabel, styles, tr, untitledLabel],
  );

  const handleOpenTaskDetail = (slotKey: SlotKey, task: TaskState) => {
    setNewTaskId(null);
    focusTask(task.id);
    openTaskDetail(slotKey, task.id);
    onChangeScreen("taskDetail");
  };

  const handleCloseTaskDetail = (discardNewTask = false) => {
    if (discardNewTask && newTaskId) {
      deleteTask(newTaskId);
    }
    setNewTaskId(null);
    closeTaskDetail();
    onChangeScreen("today");
  };

  const handleDeleteTaskDetail = () => {
    if (!detailTaskInfo) {
      return;
    }
    const { task } = detailTaskInfo;
    Alert.alert(
      tr("task.deleteConfirmTitle"),
      tr("task.deleteConfirmBody"),
      [
        { text: tr("common.cancel"), style: "cancel" },
        {
          text: tr("task.deletePermanently"),
          style: "destructive",
          onPress: () => {
            deleteTask(task.id, true);
            setNewTaskId(null);
            closeTaskDetail();
            onChangeScreen("today");
          },
        },
      ],
    );
  };

  const menuButton = (
    <Pressable style={styles.menuButton} onPress={onOpenMenu}>
      <Ionicons name="menu" size={20} color="#111827" />
    </Pressable>
  );

  if (!visible || !currentScreen || !todayState) {
    return null;
  }

  if (currentScreen === "logs") {
    return (
      <TaskLogScreen
        styles={styles}
        contentPaddingTop={defaultContentPaddingTop}
        refreshing={refreshing}
        onRefresh={onRefresh}
        title="Logs"
        headerLeft={
          <>
            {menuButton}
            <Pressable
              style={styles.backButton}
              onPress={() => onChangeScreen("today")}
            >
              <Text style={styles.linkText}>{tr("common.back")}</Text>
            </Pressable>
          </>
        }
        filtersProps={logState.filtersProps}
        logListProps={logState.logListProps}
        scrollRef={logState.scrollRef}
        onScroll={logState.onScroll}
      />
    );
  }

  if (currentScreen === "archive") {
    return (
      <TaskArchiveScreen
        styles={styles}
        contentPaddingTop={defaultContentPaddingTop}
        refreshing={refreshing}
        onRefresh={onRefresh}
        title={tr("archive.title")}
        headerLeft={
          <>
            {menuButton}
            <Pressable
              style={styles.backButton}
              onPress={() => onChangeScreen("today")}
            >
              <Text style={styles.linkText}>{tr("common.back")}</Text>
            </Pressable>
          </>
        }
        archiveListBaseProps={taskArchiveListBaseProps}
        restoreModalProps={restoreModalProps}
        onOpenRestoreModal={(item) => openRestoreModal(item.task, item.slotKey)}
        onApplyRestoreTask={applyRestoreTask}
      >
        {projectArchiveItems.map(item => <PrivateProjectTaskItem key={`${profile?.userId}:${item.task.id}`} item={item} styles={styles} tr={tr} noTagLabel={noTagLabel} untitledLabel={untitledLabel} statusLabel={statusLabel} statusPalette={statusPalette} timeBoxSchedule={timeBoxSchedule} onChanged={() => {}} />)}
      </TaskArchiveScreen>
    );
  }

  if (currentScreen === "taskDetail") {
    return (
      <TaskDetailScreen
        styles={styles}
        contentPaddingTop={taskDetailContentPaddingTop}
        title={tr("task.editTitle")}
        headerLeft={
          detailTaskInfo ? (
            <Pressable
              style={styles.detailDeleteButton}
              onPress={handleDeleteTaskDetail}
            >
              <Text style={styles.detailDeleteButtonText}>
                {tr("task.deletePermanently")}
              </Text>
            </Pressable>
          ) : null
        }
        headerRight={
          <>
            <Pressable
              style={styles.detailCancelButton}
              onPress={() => handleCloseTaskDetail(true)}
            >
              <Text style={styles.detailCancelButtonText}>{tr("common.cancel")}</Text>
            </Pressable>
            <Pressable
              style={styles.detailCompleteButton}
              onPress={() => handleCloseTaskDetail()}
            >
              <Text style={styles.detailCompleteButtonText}>{tr("task.done")}</Text>
            </Pressable>
          </>
        }
        detailTaskInfo={detailTaskInfo}
        tr={tr}
        untitledLabel={untitledLabel}
        statusLabel={statusLabel}
        statusPalette={statusPalette}
        tagOptions={tagOptions}
        onUpdateTaskName={(text) => {
          if (!detailTaskInfo) {
            return;
          }
          updateTask(detailTaskInfo.slotKey, detailTaskInfo.task.id, (prev) => ({
            ...prev,
            taskName: text,
          }));
        }}
        onUpdateTaskEstimate={(text) => {
          if (!detailTaskInfo) {
            return;
          }
          updateTask(detailTaskInfo.slotKey, detailTaskInfo.task.id, (prev) => ({
            ...prev,
            estimateMinutes: parseMinutes(text),
          }));
        }}
        onToggleTaskTag={(tag) => {
          if (!detailTaskInfo) {
            return;
          }
          toggleTaskTag(detailTaskInfo.slotKey, detailTaskInfo.task.id, tag);
        }}
        onStart={() => {
          if (!detailTaskInfo) {
            return;
          }
          startTask(detailTaskInfo.slotKey, detailTaskInfo.task.id);
        }}
        onPause={() => {
          if (!detailTaskInfo) {
            return;
          }
          pauseTask(detailTaskInfo.slotKey, detailTaskInfo.task.id);
        }}
        onDone={() => {
          if (!detailTaskInfo) {
            return;
          }
          stopTask(detailTaskInfo.slotKey, detailTaskInfo.task.id, "completed");
        }}
        onSearchToken={onSearchToken}
        language={language}
      />
    );
  }

  return (
    <>
      <TaskScreen planningSelectedDate={selectedDate}
        styles={styles}
        insetsTop={insetsTop}
        title={selectedDate}
        headerLeft={menuButton}
        headerRight={
          <>
            <Pressable style={styles.calendarButton} onPress={onOpenDatePicker}>
              <Ionicons name="calendar-outline" size={18} color="#111827" />
            </Pressable>
            {selectionMode ? (
              <Pressable
                style={styles.exitSelectionButton}
                onPress={exitSelectionMode}
              >
                <Text style={styles.exitSelectionButtonText}>
                  {tr("task.selectExit")}
                </Text>
              </Pressable>
            ) : null}
          </>
        }
        contentPaddingTop={todayContentPaddingTop}
        footerPaddingBottom={footerPaddingBottom}
        refreshing={refreshing}
        onRefresh={() => {
          onRefresh();
          void refreshProjectTasks();
        }}
        trf={trf}
        routineSuggestions={routineSuggestions}
        currentSlotLabel={getSlotLabel(language, currentSlot)}
        onAddSuggestion={addSuggestion}
        onDismissSuggestion={(suggestion: Suggestion) => {
          void dismissSuggestion(suggestion);
        }}
        onOpenTaskDetail={handleOpenTaskDetail}
        onDeleteTask={deleteTask}
        onDeleteSelectedTasks={() => {
          const sharedIds = [...selectedSet].filter(id => id.startsWith("project:"));
          void Promise.all(sharedIds.map(id => deleteProjectTask(id.slice(8)))).then(() => { deleteSelectedTasks(); exitSelectionMode(); }).catch(error => Alert.alert("消去できません", error.message));
        }}
        onArchiveTask={archiveTask}
        onOpenMoveModal={openMoveModal}
        onOpenMoveSelectedModal={openMoveSelectedModal}
        onMoveTaskToSlot={(
          fromSlotKey: SlotKey,
          taskId: string,
          targetSlotKey: SlotKey,
        ) => {
          if (taskId.startsWith("project:")) {
            void updateProjectTask(taskId.slice(8), { privateSlotKey: targetSlotKey }).catch(error => Alert.alert("移動できません", error.message));
          } else void moveTask(taskId, fromSlotKey, selectedDate, targetSlotKey);
        }}
        taskListBaseProps={taskListBaseProps}
        moveModalProps={moveModalProps}
        projectTasksBySlot={projectTasksBySlot}
        onProjectTaskChanged={() => {}}
        timeBoxSchedule={timeBoxSchedule}
      />
      {inProgressInfo ? (
        <TimerBar
          styles={styles}
          label={tr("footer.inProgressTask")}
          onPress={() =>
            handleOpenTaskDetail(inProgressInfo.slotKey, inProgressInfo.task)
          }
        />
      ) : null}
    </>
  );
};

export default TaskWorkspaceScreen;
