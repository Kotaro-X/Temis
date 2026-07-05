import React from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

type Props = {
  styles: Record<string, any>;
  tr: (key: string) => string;
  isLandscape: boolean;
  logView: "table" | "board";
  onChangeLogView: (value: "table" | "board") => void;
  logQuery: string;
  onChangeLogQuery: (value: string) => void;
  tagFilterOptions: string[];
  logTagFilter: string;
  onChangeLogTagFilter: (value: string) => void;
  noTagLabel: string;
  allTagFilter: string;
  noTagKey: string;
};

export type TaskFiltersProps = Props;

const TaskFilters = ({
  styles,
  tr,
  isLandscape,
  logView,
  onChangeLogView,
  logQuery,
  onChangeLogQuery,
  tagFilterOptions,
  logTagFilter,
  onChangeLogTagFilter,
  noTagLabel,
  allTagFilter,
  noTagKey,
}: Props) => {
  return (
    <View style={styles.logControls}>
      {!isLandscape ? (
        <View style={styles.viewToggleRow}>
          <Pressable
            style={[
              styles.viewToggleButton,
              logView === "table" && styles.viewToggleButtonActive,
            ]}
            onPress={() => onChangeLogView("table")}
          >
            <Text
              style={[
                styles.viewToggleText,
                logView === "table" && styles.viewToggleTextActive,
              ]}
            >
              {tr("logs.view.table")}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.viewToggleButton,
              logView === "board" && styles.viewToggleButtonActive,
            ]}
            onPress={() => onChangeLogView("board")}
          >
            <Text
              style={[
                styles.viewToggleText,
                logView === "board" && styles.viewToggleTextActive,
              ]}
            >
              {tr("logs.view.board")}
            </Text>
          </Pressable>
        </View>
      ) : null}
      <TextInput
        style={styles.logSearchInput}
        placeholder={tr("logs.searchPlaceholder")}
        value={logQuery}
        onChangeText={onChangeLogQuery}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {tagFilterOptions.map((tag) => (
          <Pressable
            key={tag}
            style={[
              styles.filterChip,
              logTagFilter === tag && styles.filterChipActive,
            ]}
            onPress={() => onChangeLogTagFilter(tag)}
          >
            <Text
              style={[
                styles.filterChipText,
                logTagFilter === tag && styles.filterChipTextActive,
              ]}
            >
              {tag === allTagFilter ? tr("common.all") : tag === noTagKey ? noTagLabel : tag}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
};

export default TaskFilters;
