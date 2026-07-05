import React, { useMemo } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";

import type { LogEntry } from "../../types";
import { tf, type AppLanguage } from "../../i18n";

type DailyTotal = {
  date: string;
  minutes: number;
};

type AnalysisChartPoint = {
  x: number;
  y: number;
  date: string;
};

type AnalysisXAxisLabel = {
  key: string;
  x: number;
  label: string;
  anchor: "start" | "middle" | "end";
};

type AnalysisYAxisTick = {
  key: string;
  y: number;
  label: string;
};

const round1 = (num: number) => Math.round(num * 10) / 10;
const formatMinutes = (num: number) => round1(num).toFixed(1);
const diffLabel = (diff: number) =>
  diff >= 0 ? `+${formatMinutes(diff)}` : formatMinutes(diff);

const buildSmoothLinePath = (points: Array<{ x: number; y: number }>) => {
  if (points.length === 0) {
    return "";
  }
  if (points.length === 1) {
    const point = points[0];
    return `M ${point.x} ${point.y} L ${point.x} ${point.y}`;
  }
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const curr = points[index];
    const controlX = (prev.x + curr.x) / 2;
    path += ` Q ${controlX} ${prev.y} ${curr.x} ${curr.y}`;
  }
  return path;
};

const LogAnalysisLineChart = ({
  width,
  height,
  plotLeft,
  plotTop,
  plotRight,
  plotBottom,
  points,
  xLabels,
  yTicks,
  showMarkers,
  markerRadius,
}: {
  width: number;
  height: number;
  plotLeft: number;
  plotTop: number;
  plotRight: number;
  plotBottom: number;
  points: AnalysisChartPoint[];
  xLabels: AnalysisXAxisLabel[];
  yTicks: AnalysisYAxisTick[];
  showMarkers: boolean;
  markerRadius: number;
}) => {
  const linePath = useMemo(
    () => buildSmoothLinePath(points.map(({ x, y }) => ({ x, y }))),
    [points],
  );
  const axisX = width - plotRight;
  const axisY = height - plotBottom;
  return (
    <Svg width={width} height={height}>
      {yTicks.map((tick, index) => (
        <React.Fragment key={tick.key}>
          <Line
            x1={plotLeft}
            y1={tick.y}
            x2={axisX}
            y2={tick.y}
            stroke={index === yTicks.length - 1 ? "#cbd5e1" : "#e5e7eb"}
            strokeWidth={1}
          />
          <SvgText
            x={plotLeft - 6}
            y={tick.y + 3}
            fontSize={10}
            fill="#94a3b8"
            textAnchor="end"
          >
            {tick.label}
          </SvgText>
        </React.Fragment>
      ))}
      <Line
        x1={plotLeft}
        y1={plotTop}
        x2={plotLeft}
        y2={axisY}
        stroke="#e2e8f0"
        strokeWidth={1}
      />
      {points.length > 0 ? (
        <Path
          d={linePath}
          fill="none"
          stroke="#334155"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      {showMarkers
        ? points.map((point) => (
            <Circle
              key={`marker-${point.date}`}
              cx={point.x}
              cy={point.y}
              r={markerRadius}
              fill="#334155"
            />
          ))
        : null}
      {xLabels.map((item) => (
        <SvgText
          key={item.key}
          x={item.x}
          y={height - 4}
          fontSize={10}
          fill="#94a3b8"
          textAnchor={item.anchor}
        >
          {item.label}
        </SvgText>
      ))}
    </Svg>
  );
};

const LogAnalysisSummaryRow = ({
  dailyTotals,
  language,
  styles,
}: {
  dailyTotals: DailyTotal[];
  language: AppLanguage;
  styles: Record<string, any>;
}) => {
  const summary = useMemo(() => {
    let total = 0;
    for (const item of dailyTotals) {
      total += item.minutes;
    }
    const days = dailyTotals.length;
    const avg = days > 0 ? total / days : 0;
    return {
      totalMinutes: Math.round(total),
      avgMinutes: avg.toFixed(1),
    };
  }, [dailyTotals]);

  return (
    <View style={styles.logAnalysisSummaryRow}>
      <Text style={styles.logAnalysisSummaryText}>
        {tf(language, "logs.summary", {
          total: summary.totalMinutes,
          avg: summary.avgMinutes,
        })}
      </Text>
    </View>
  );
};

const LandscapeLogView = ({
  logs,
  language,
  styles,
  tr,
  noTagLabel,
  untitledLabel,
}: {
  logs: LogEntry[];
  language: AppLanguage;
  styles: Record<string, any>;
  tr: (key: string) => string;
  noTagLabel: string;
  untitledLabel: string;
}) => {
  return (
    <View style={styles.logLandscapeTable}>
      <View style={[styles.logLandscapeRow, styles.logLandscapeHeaderRow]}>
        <View style={styles.logLandscapeMetaCell}>
          <Text style={styles.logLandscapeHeaderCell}>{tr("logs.task")}</Text>
        </View>
        <View style={styles.logLandscapeMetricCell}>
          <Text style={[styles.logLandscapeHeaderCell, styles.logLandscapeHeaderMetric]}>
            {tr("logs.estimate")}
          </Text>
        </View>
        <View style={styles.logLandscapeMetricCell}>
          <Text style={[styles.logLandscapeHeaderCell, styles.logLandscapeHeaderMetric]}>
            {tr("logs.actual")}
          </Text>
        </View>
        <View style={styles.logLandscapeDiffCell}>
          <Text style={[styles.logLandscapeHeaderCell, styles.logLandscapeHeaderMetric]}>
            {tr("logs.diff")}
          </Text>
        </View>
      </View>
      {logs.map((log) => {
        const diff = round1(log.actualMinutes - log.estimateMinutes);
        const tags = log.tags.length > 0 ? log.tags : [noTagLabel];
        const visibleTags = tags.slice(0, 3);
        const overflowCount = tags.length - visibleTags.length;
        const diffColor = diff > 0 ? "#dc2626" : diff < 0 ? "#2563eb" : "#6b7280";
        return (
          <View key={log.id} style={styles.logLandscapeRow}>
            <View style={styles.logLandscapeMetaCell}>
              <View style={styles.logLandscapeTitleRow}>
                <Text style={styles.logLandscapeTitle} numberOfLines={1} ellipsizeMode="tail">
                  {log.taskName || untitledLabel}
                </Text>
                <View style={styles.logLandscapeTags}>
                  {visibleTags.map((tag) => (
                    <View
                      key={tag}
                      style={tag === noTagLabel ? styles.logLandscapeTagChipMuted : styles.logLandscapeTagChip}
                    >
                      <Text
                        style={tag === noTagLabel ? styles.logLandscapeTagTextMuted : styles.logLandscapeTagText}
                      >
                        {tag}
                      </Text>
                    </View>
                  ))}
                  {overflowCount > 0 ? (
                    <View style={styles.logLandscapeTagChipMuted}>
                      <Text style={styles.logLandscapeTagTextMuted}>{`+${overflowCount}`}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <Text style={styles.logLandscapeMeta}>{log.date}</Text>
            </View>
            <View style={styles.logLandscapeMetricCell}>
              <Text style={styles.logLandscapeValue}>{formatMinutes(log.estimateMinutes)}m</Text>
            </View>
            <View style={styles.logLandscapeMetricCell}>
              <Text style={styles.logLandscapeValue}>{formatMinutes(log.actualMinutes)}m</Text>
            </View>
            <View style={styles.logLandscapeDiffCell}>
              <Text style={[styles.logLandscapeValue, { color: diffColor }]}>
                {`${diffLabel(diff)}m`}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
};

type Props = {
  styles: Record<string, any>;
  tr: (key: string) => string;
  language: AppLanguage;
  isLandscape: boolean;
  logView: "table" | "board";
  filteredLogs: LogEntry[];
  noTagLabel: string;
  untitledLabel: string;
  boardTags: string[];
  logAnalysisCollapsed: boolean;
  onToggleAnalysis: () => void;
  logAnalysisPeriod: 7 | 30 | 365;
  onChangePeriod: (period: 7 | 30 | 365) => void;
  onPrevRange: () => void;
  onNextRange: () => void;
  logAnalysisRangeLabel: string;
  logAnalysisCanNext: boolean;
  logAnalysisTagOptions: string[];
  logAnalysisTag: string;
  onChangeAnalysisTag: (tag: string) => void;
  allTagFilter: string;
  noTagKey: string;
  logAnalysisChartHeight: number;
  logAnalysisWidth: number;
  onLayoutChart: (width: number) => void;
  logAnalysisPlot: {
    plotLeft: number;
    plotTop: number;
    plotRight: number;
    plotBottom: number;
  };
  logAnalysisPoints: AnalysisChartPoint[];
  logAnalysisXAxisLabels: AnalysisXAxisLabel[];
  logAnalysisYAxisTicks: AnalysisYAxisTick[];
  logAnalysisShowMarkers: boolean;
  logAnalysisMarkerRadius: number;
  logAnalysisTotals: DailyTotal[];
  logAnalysisDisplayMax: number;
  tableScrollRef?: React.RefObject<ScrollView | null>;
  boardScrollRef?: React.RefObject<ScrollView | null>;
  onTableScroll?: (event: any) => void;
  onBoardScroll?: (event: any) => void;
};

export type TaskLogListProps = Props;

const TaskLogList = ({
  styles,
  tr,
  language,
  isLandscape,
  logView,
  filteredLogs,
  noTagLabel,
  untitledLabel,
  boardTags,
  logAnalysisCollapsed,
  onToggleAnalysis,
  logAnalysisPeriod,
  onChangePeriod,
  onPrevRange,
  onNextRange,
  logAnalysisRangeLabel,
  logAnalysisCanNext,
  logAnalysisTagOptions,
  logAnalysisTag,
  onChangeAnalysisTag,
  allTagFilter,
  noTagKey,
  logAnalysisChartHeight,
  logAnalysisWidth,
  onLayoutChart,
  logAnalysisPlot,
  logAnalysisPoints,
  logAnalysisXAxisLabels,
  logAnalysisYAxisTicks,
  logAnalysisShowMarkers,
  logAnalysisMarkerRadius,
  logAnalysisTotals,
  logAnalysisDisplayMax,
  tableScrollRef,
  boardScrollRef,
  onTableScroll,
  onBoardScroll,
}: Props) => {
  return (
    <>
      <View style={styles.logAnalysisPanel}>
        <Pressable style={styles.logAnalysisHeader} onPress={onToggleAnalysis}>
          <Text style={styles.logAnalysisTitle}>{tr("logs.analysisPanel")}</Text>
          <Text style={styles.logAnalysisToggle}>{logAnalysisCollapsed ? "▶︎" : "▼"}</Text>
        </Pressable>
        {!logAnalysisCollapsed ? (
          <>
            <View style={styles.logAnalysisPeriodRow}>
              {[7, 30, 365].map((period) => (
                <Pressable
                  key={period}
                  style={[
                    styles.logAnalysisChip,
                    logAnalysisPeriod === period && styles.logAnalysisChipActive,
                  ]}
                  onPress={() => onChangePeriod(period as 7 | 30 | 365)}
                >
                  <Text
                    style={[
                      styles.logAnalysisChipText,
                      logAnalysisPeriod === period && styles.logAnalysisChipTextActive,
                    ]}
                  >
                    {period === 7 ? tr("logs.range7d") : period === 30 ? tr("logs.range1m") : tr("logs.range1y")}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.logAnalysisRangeRow}>
              <Pressable style={styles.logAnalysisNavButton} onPress={onPrevRange}>
                <Text style={styles.logAnalysisNavText}>◀︎</Text>
              </Pressable>
              <Text style={styles.logAnalysisRangeText}>{logAnalysisRangeLabel}</Text>
              <Pressable
                style={[
                  styles.logAnalysisNavButton,
                  !logAnalysisCanNext && styles.logAnalysisNavButtonDisabled,
                ]}
                onPress={onNextRange}
                disabled={!logAnalysisCanNext}
              >
                <Text
                  style={[
                    styles.logAnalysisNavText,
                    !logAnalysisCanNext && styles.logAnalysisNavTextDisabled,
                  ]}
                >
                  ▶︎
                </Text>
              </Pressable>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.logAnalysisTagRow}
            >
              {logAnalysisTagOptions.map((tag) => (
                <Pressable
                  key={tag}
                  style={[
                    styles.logAnalysisChip,
                    logAnalysisTag === tag && styles.logAnalysisChipActive,
                  ]}
                  onPress={() => onChangeAnalysisTag(tag)}
                >
                  <Text
                    style={[
                      styles.logAnalysisChipText,
                      logAnalysisTag === tag && styles.logAnalysisChipTextActive,
                    ]}
                  >
                    {tag === allTagFilter ? tr("common.all") : tag === noTagKey ? noTagLabel : tag}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <View
              style={[
                styles.logAnalysisChartContainer,
                { height: logAnalysisChartHeight },
              ]}
              onLayout={(event) => onLayoutChart(event.nativeEvent.layout.width)}
            >
              {logAnalysisWidth > 0 ? (
                <LogAnalysisLineChart
                  width={logAnalysisWidth}
                  height={logAnalysisChartHeight}
                  plotLeft={logAnalysisPlot.plotLeft}
                  plotTop={logAnalysisPlot.plotTop}
                  plotRight={logAnalysisPlot.plotRight}
                  plotBottom={logAnalysisPlot.plotBottom}
                  points={logAnalysisPoints}
                  xLabels={logAnalysisXAxisLabels}
                  yTicks={logAnalysisYAxisTicks}
                  showMarkers={logAnalysisShowMarkers}
                  markerRadius={logAnalysisMarkerRadius}
                />
              ) : null}
            </View>
            <LogAnalysisSummaryRow dailyTotals={logAnalysisTotals} language={language} styles={styles} />
            <Text style={styles.logAnalysisHint}>
              {`${tr("logs.max")} ${formatMinutes(logAnalysisDisplayMax)}m`}
            </Text>
          </>
        ) : null}
      </View>

      {isLandscape ? (
        <LandscapeLogView
          logs={filteredLogs}
          language={language}
          styles={styles}
          tr={tr}
          noTagLabel={noTagLabel}
          untitledLabel={untitledLabel}
        />
      ) : logView === "table" ? (
        <ScrollView
          ref={tableScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          onScroll={onTableScroll}
          scrollEventThrottle={16}
        >
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeaderRow]}>
              <Text style={[styles.tableCell, styles.tableCellDate]}>{tr("logs.date")}</Text>
              <Text style={[styles.tableCell, styles.tableCellTitle]}>{tr("logs.task")}</Text>
              <Text style={[styles.tableCell, styles.tableCellTag]}>{tr("logs.tag")}</Text>
              <Text style={[styles.tableCell, styles.tableCellNumber]}>{tr("logs.estimate")}</Text>
              <Text style={[styles.tableCell, styles.tableCellNumber]}>{tr("logs.actual")}</Text>
              <Text style={[styles.tableCell, styles.tableCellNumber]}>{tr("logs.diff")}</Text>
            </View>
            {filteredLogs.map((log) => {
              const diff = round1(log.actualMinutes - log.estimateMinutes);
              const diffColor = diff > 0 ? "#dc2626" : diff < 0 ? "#2563eb" : "#6b7280";
              return (
                <View key={log.id} style={styles.tableRow}>
                  <Text style={[styles.tableCell, styles.tableCellDate]}>{log.date}</Text>
                  <Text style={[styles.tableCell, styles.tableCellTitle]}>
                    {log.taskName || untitledLabel}
                  </Text>
                  <Text style={[styles.tableCell, styles.tableCellTag]}>
                    {log.tags.length > 0 ? log.tags.join(", ") : noTagLabel}
                  </Text>
                  <Text style={[styles.tableCell, styles.tableCellNumber]}>
                    {formatMinutes(log.estimateMinutes)}
                  </Text>
                  <Text style={[styles.tableCell, styles.tableCellNumber]}>
                    {formatMinutes(log.actualMinutes)}
                  </Text>
                  <Text style={[styles.tableCell, styles.tableCellNumber, { color: diffColor }]}>
                    {diffLabel(diff)}
                  </Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          ref={boardScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          onScroll={onBoardScroll}
          scrollEventThrottle={16}
        >
          <View style={styles.boardRow}>
            {boardTags.map((tag) => {
              const columnLogs =
                tag === noTagKey
                  ? filteredLogs.filter((log) => log.tags.length === 0)
                  : filteredLogs.filter((log) => log.tags.includes(tag));
              return (
                <View key={tag} style={styles.boardColumn}>
                  <Text style={styles.boardColumnTitle}>
                    {tag === noTagKey ? noTagLabel : tag}
                  </Text>
                  {columnLogs.map((log) => {
                    const diff = round1(log.actualMinutes - log.estimateMinutes);
                    const diffColor = diff > 0 ? "#dc2626" : diff < 0 ? "#2563eb" : "#6b7280";
                    return (
                      <View key={log.id} style={styles.boardCard}>
                        <Text style={styles.boardCardTitle}>{log.taskName || untitledLabel}</Text>
                        <Text style={styles.boardCardMeta}>{log.date}</Text>
                        <Text style={styles.boardCardMeta}>
                          {`${tr("logs.estimate")} ${formatMinutes(log.estimateMinutes)}m / ${tr(
                            "logs.actual",
                          )} ${formatMinutes(log.actualMinutes)}m`}
                        </Text>
                        <Text style={[styles.boardCardMeta, { color: diffColor }]}>
                          {`${tr("logs.diff")} ${diffLabel(diff)}m`}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </>
  );
};

export default TaskLogList;
