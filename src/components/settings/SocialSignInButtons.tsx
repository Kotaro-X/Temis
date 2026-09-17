import React from "react";
import { StyleSheet, useColorScheme, useWindowDimensions, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { GoogleSigninButton } from "@react-native-google-signin/google-signin";

type Props = {
  onGoogle?: () => void;
  onApple?: () => void;
  showApple: boolean;
  disabled: boolean;
};

/** Shared geometry; each provider still renders its official logo and wording. */
export default function SocialSignInButtons({ onGoogle, onApple, showApple, disabled }: Props) {
  const dark = useColorScheme() === "dark";
  const { fontScale } = useWindowDimensions();
  const height = Math.max(48, Math.ceil(48 * Math.min(fontScale, 2)));
  const buttonStyle = { width: "100%" as const, height };
  return (
    <View style={styles.group}>
      <View style={[styles.button, buttonStyle, disabled && styles.disabled]}>
        <GoogleSigninButton
          size={GoogleSigninButton.Size.Wide}
          color={dark ? GoogleSigninButton.Color.Dark : GoogleSigninButton.Color.Light}
          onPress={onGoogle}
          disabled={disabled || !onGoogle}
          style={buttonStyle}
        />
      </View>
      {showApple && onApple ? (
        <View style={[styles.button, buttonStyle, disabled && styles.disabled]} pointerEvents={disabled ? "none" : "auto"} accessibilityElementsHidden={disabled} importantForAccessibility={disabled ? "no-hide-descendants" : "auto"}>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={8}
            onPress={() => { if (!disabled) onApple(); }}
            style={buttonStyle}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { width: "100%", maxWidth: 400, alignSelf: "center", gap: 12, marginTop: 12 },
  button: { borderRadius: 8, overflow: "hidden" },
  disabled: { opacity: 0.5 },
});
