import React from 'react';
import { Pressable, SafeAreaView, ScrollView, Text } from 'react-native';

type State = { error: Error | null; attempt: number };

// Load the application inside the boundary: eager imports in index.ts fail
// before React mounts and cannot be handled by componentDidCatch.
function Application() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep module evaluation inside React's error boundary.
  const App = (require('../../../App') as typeof import('../../../App')).default;
  return <App />;
}

export default class StartupBoundary extends React.Component<object, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[startup]', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return <Application key={this.state.attempt} />;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
          <Text style={{ fontSize: 22, color: '#111' }}>起動処理でエラーが発生しました</Text>
          <Text style={{ color: '#333' }}>保存済みデータは削除していません。再試行しても開けない場合は、下のエラー内容をお知らせください。</Text>
          <Text selectable style={{ color: '#333' }}>{this.state.error.message || String(this.state.error)}</Text>
          <Pressable accessibilityRole="button" onPress={() => this.setState(state => ({ error: null, attempt: state.attempt + 1 }))} style={{ padding: 16 }}>
            <Text style={{ color: '#0066cc', fontSize: 18 }}>再試行する</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }
}
