import SwiftUI
import WidgetKit

private struct MemoEntry: TimelineEntry {
  let date: Date
}

private struct MemoProvider: TimelineProvider {
  func placeholder(in context: Context) -> MemoEntry { MemoEntry(date: Date()) }
  func getSnapshot(in context: Context, completion: @escaping (MemoEntry) -> Void) {
    completion(MemoEntry(date: Date()))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<MemoEntry>) -> Void) {
    completion(Timeline(entries: [MemoEntry(date: Date())], policy: .never))
  }
}

private struct MemoWidgetView: View {
  @Environment(\.widgetFamily) private var family

  var body: some View {
    content
      .widgetURL(URL(string: "exp+temis://memo/new")!)
      .accessibilityLabel(Text("Write a memo"))
  }

  @ViewBuilder private var content: some View {
    if #available(iOSApplicationExtension 16.0, *), family == .accessoryCircular || family == .accessoryRectangular {
      layout
    } else if #available(iOSApplicationExtension 17.0, *) {
      layout.containerBackground(for: .widget) { Color(.systemBackground) }
    } else {
      layout.padding().background(Color(.systemBackground))
    }
  }

  @ViewBuilder private var layout: some View {
    if #available(iOSApplicationExtension 16.0, *), family == .accessoryCircular {
      ZStack {
        AccessoryWidgetBackground()
        Image(systemName: "square.and.pencil").font(.title2).widgetAccentable()
      }
    } else if #available(iOSApplicationExtension 16.0, *), family == .accessoryRectangular {
      HStack(spacing: 8) {
        Image(systemName: "square.and.pencil").font(.title2).widgetAccentable()
        VStack(alignment: .leading, spacing: 2) {
          Text("Temis").font(.headline)
          Text("Write a memo").font(.caption).lineLimit(1).minimumScaleFactor(0.8)
        }
      }
    } else {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text("Temis").font(.caption).foregroundStyle(.secondary)
          Spacer()
        }
        Spacer(minLength: 0)
        Image(systemName: "square.and.pencil").font(.largeTitle).foregroundStyle(Color.blue)
        Text("Write a memo").font(.headline).lineLimit(1).minimumScaleFactor(0.8)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
  }
}

@main
struct TemisMemoWidget: Widget {
  private var families: [WidgetFamily] {
    if #available(iOSApplicationExtension 16.0, *) {
      return [.systemSmall, .accessoryCircular, .accessoryRectangular]
    }
    return [.systemSmall]
  }

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "TemisMemoWidget", provider: MemoProvider()) { _ in
      MemoWidgetView()
    }
    .configurationDisplayName("New memo")
    .description("Open Temis and write a memo.")
    .supportedFamilies(families)
  }
}
