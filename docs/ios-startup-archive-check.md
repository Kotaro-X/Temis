# iOS 起動クラッシュのArchive検査

2026-10-31のTestFlight 2.0.2 (121)は、最初の画面生成で
`RCTThirdPartyComponentsProvider.thirdPartyFabricComponents` が例外を発生させた。
実機ログとArchiveのdSYMのUUIDが一致することを確認してシンボル化した結果、
生成された辞書が参照する以下のクラスが実行ファイルに存在しなかった。

- `RNGoogleSignInButtonComponentView`
- `RNCSafeAreaProviderComponentView`
- `RNCSafeAreaViewComponentView`

アプリはNew Architectureだが、依存Podの評価時には
`RCT_NEW_ARCH_ENABLED`が未設定で、Google Sign-InとSafe Areaが旧方式で生成されていた。
`NSClassFromString`のnilをNSDictionaryに入れるため、コンパイルが成功しても起動時に落ちる。

`plugins/withIosNewArchitecture.js`は、Podfileでautolinkingが走る前に
`Podfile.properties.json`に基づいてこの変数を明示的に設定する。
シェルの古い設定にも左右されず、Expo prebuildで再生成しても修正を維持する。
既存のネイティブプロジェクトにはPodfile修正後に`pod install --no-repo-update`が必要。

Archive後、配布前にリポジトリのルートから実行する。

```sh
node scripts/check-ios-fabric-archive.mjs /absolute/path/to/Temis.xcarchive
```

この検査は、現在の生成済みproviderにあるクラスがArchiveのdSYM内にすべて存在することと、
dSYMと実行ファイルのUUID一致を検証する。Archiveと同じネイティブ生成状態で実行すること。
実機の起動・ログイン・画面表示の確認は別途手動で行う。

## Xcode 27.2の最低iOSバージョン検査

一部のPod（Privacy用リソースbundleを含む）はiOS 9〜13を最低対応に設定しており、
Xcode 27.2ではArchiveの準備時に対応範囲外としてエラーになる。
`withIosPodsDeploymentTarget`は`react_native_post_install`後に、Podの設定を
アプリの最低対応バージョン（`ios.deploymentTarget`、未指定なら15.1）まで引き上げる。
それより新しいバージョンが必要なPodの設定は維持する。

既存のネイティブプロジェクトにも修正済みPodfileを適用後、
`cd ios && pod install --no-repo-update`でPodsプロジェクトを更新する。
