import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

type Props<T> = {
  answerTitle: string;
  answerText: string;
  errorText?: string | null;
  citedTitle: string;
  allTitle: string;
  showAllLabel: string;
  hideAllLabel: string;
  citedEvidence: T[];
  allEvidence: T[];
  showAll: boolean;
  onToggleAll: () => void;
  getEvidenceKey: (item: T) => string;
  renderEvidence: (item: T, options: { cited: boolean; allSection: boolean }) => React.ReactNode;
};

const AIAnswerEvidencePanel = <T,>({
  answerTitle,
  answerText,
  errorText,
  citedTitle,
  allTitle,
  showAllLabel,
  hideAllLabel,
  citedEvidence,
  allEvidence,
  showAll,
  onToggleAll,
  getEvidenceKey,
  renderEvidence,
}: Props<T>) => {
  const citedKeys = new Set(citedEvidence.map(getEvidenceKey));
  return (
    <View style={styles.container}>
      {answerText || errorText ? <View style={[styles.answer, errorText ? styles.answerError : null]}>
        <Text style={styles.answerLabel}>{answerTitle}</Text>
        <ScrollView style={styles.answerScroll} nestedScrollEnabled>
          <Text style={[styles.answerText, errorText ? styles.errorText : null]}>
            {errorText || answerText}
          </Text>
        </ScrollView>
      </View> : null}
      {citedEvidence.length ? <View style={styles.section}>
        <Text style={styles.sectionTitle}>{citedTitle}</Text>
        {citedEvidence.map((item) => (
          <React.Fragment key={`cited:${getEvidenceKey(item)}`}>
            {renderEvidence(item, { cited: true, allSection: false })}
          </React.Fragment>
        ))}
      </View> : null}
      {allEvidence.length ? <Pressable style={styles.toggle} onPress={onToggleAll}>
        <Text style={styles.toggleText}>
          {showAll ? hideAllLabel : `${showAllLabel} (${allEvidence.length})`}
        </Text>
      </Pressable> : null}
      {showAll ? <View style={styles.section}>
        <Text style={styles.sectionTitle}>{allTitle}</Text>
        {allEvidence.map((item) => (
          <React.Fragment key={`all:${getEvidenceKey(item)}`}>
            {renderEvidence(item, {
              cited: citedKeys.has(getEvidenceKey(item)),
              allSection: true,
            })}
          </React.Fragment>
        ))}
      </View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { gap: 10 },
  answer: { borderWidth: 1, borderColor: "#111827", borderRadius: 12, padding: 12, gap: 8 },
  answerError: { borderColor: "#b91c1c", backgroundColor: "#fef2f2" },
  answerLabel: { alignSelf: "flex-start", color: "#fff", backgroundColor: "#111827", paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, fontWeight: "800" },
  answerScroll: { maxHeight: 170 },
  answerText: { color: "#111827", fontSize: 14, lineHeight: 21 },
  errorText: { color: "#b91c1c" },
  section: { gap: 8 },
  sectionTitle: { color: "#111827", fontSize: 15, fontWeight: "800" },
  toggle: { alignSelf: "flex-start", paddingVertical: 5 },
  toggleText: { color: "#2563eb", fontWeight: "700" },
});

export default AIAnswerEvidencePanel;
