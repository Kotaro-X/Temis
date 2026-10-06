import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const reactNativeRoot = dirname(require.resolve("react-native/package.json"));
const reactNativeVersion = require("react-native/package.json").version;
if (reactNativeVersion !== "0.81.5") {
  throw new Error(
    `Review the memo scroll patch before using React Native ${reactNativeVersion}.`,
  );
}

const sourcePath = join(
  reactNativeRoot,
  "React/Fabric/Mounting/ComponentViews/TextInput/RCTTextInputComponentView.mm",
);
const originalStart = `  _comingFromJS = YES;
  if (value && ![value isEqualToString:_backedTextInputView.attributedText.string]) {`;
const patchedStart = `  // Updating a multiline memo from its accessory toolbar must not move the
  // visible text. Native typing still uses UIKit's normal caret scrolling.
  BOOL preserveMemoScrollOffset =
      value && ![value isEqualToString:_backedTextInputView.attributedText.string] &&
      [self.nativeId hasPrefix:@"memo-editor-"] && [_backedTextInputView isKindOfClass:[UITextView class]];
  CGPoint memoScrollOffset = preserveMemoScrollOffset ? _backedTextInputView.contentOffset : CGPointZero;

  _comingFromJS = YES;
  if (value && ![value isEqualToString:_backedTextInputView.attributedText.string]) {`;
const originalEnd = `    [_backedTextInputView scrollRangeToVisible:NSMakeRange(offsetEnd, 0)];
  }
  _comingFromJS = NO;
}`;
const previousPatchedEnd = `    if (!preserveMemoScrollOffset) {
      [_backedTextInputView scrollRangeToVisible:NSMakeRange(offsetEnd, 0)];
    }
  }
  if (preserveMemoScrollOffset) {
    [(UITextView *)_backedTextInputView setContentOffset:memoScrollOffset animated:NO];
  }
  _comingFromJS = NO;
}`;
const patchedEnd = `    if (!preserveMemoScrollOffset) {
      [_backedTextInputView scrollRangeToVisible:NSMakeRange(offsetEnd, 0)];
    }
  }
  if (preserveMemoScrollOffset) {
    UITextView *memoTextView = (UITextView *)_backedTextInputView;
    [memoTextView layoutIfNeeded];
    [memoTextView setContentOffset:memoScrollOffset animated:NO];
    // Like normal typing, move only enough to reveal the resulting caret.
    // Always restoring the offset would hide it when brackets wrap onto a new line.
    if (memoTextView.selectedTextRange) {
      CGRect caretRect = [memoTextView caretRectForPosition:memoTextView.selectedTextRange.end];
      [memoTextView scrollRectToVisible:caretRect animated:NO];
    }
  }
  _comingFromJS = NO;
}`;

let source = readFileSync(sourcePath, "utf8");
const alreadyPatched = source.includes(patchedStart) && source.includes(patchedEnd);
if (alreadyPatched) {
  console.log("React Native memo scroll patch is already applied.");
  process.exit(0);
}
if (process.argv.includes("--check")) {
  throw new Error("React Native memo scroll patch is not applied.");
}
// Upgrade an already installed first revision without requiring node_modules removal.
if (source.includes(patchedStart) && source.includes(previousPatchedEnd)) {
  source = source.replace(previousPatchedEnd, patchedEnd);
  writeFileSync(sourcePath, source);
  console.log("Updated React Native memo scroll patch.");
  process.exit(0);
}
if (!source.includes(originalStart) || !source.includes(originalEnd)) {
  throw new Error("React Native TextInput source changed; review the memo scroll patch.");
}
source = source.replace(originalStart, patchedStart).replace(originalEnd, patchedEnd);
writeFileSync(sourcePath, source);
console.log("Applied React Native memo scroll patch.");
