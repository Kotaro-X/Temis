import React from "react";
import {
  RefreshControl,
  ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import Header from "../components/common/Header";
import TaskFilters, {
  type TaskFiltersProps,
} from "../components/tasks/TaskFilters";
import TaskLogList, {
  type TaskLogListProps,
} from "../components/tasks/TaskLogList";

type Props = {
  styles: Record<string, any>;
  contentPaddingTop: number;
  refreshing: boolean;
  onRefresh: () => void;
  title: string;
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  filtersProps: TaskFiltersProps;
  logListProps: TaskLogListProps;
  scrollRef?: React.RefObject<ScrollView | null>;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

const TaskLogScreen = ({
  styles,
  contentPaddingTop,
  refreshing,
  onRefresh,
  title,
  headerLeft,
  headerRight,
  filtersProps,
  logListProps,
  scrollRef,
  onScroll,
}: Props) => {
  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={[
        styles.content,
        { paddingTop: contentPaddingTop },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      onScroll={onScroll}
      scrollEventThrottle={16}
    >
      <Header
        styles={styles}
        title={title}
        left={headerLeft}
        right={headerRight}
      />
      <TaskFilters {...filtersProps} />
      <TaskLogList {...logListProps} />
    </ScrollView>
  );
};

export default TaskLogScreen;
