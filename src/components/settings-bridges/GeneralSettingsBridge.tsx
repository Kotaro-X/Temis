import React from "react";

import type { AppLanguage } from "../../i18n";

type Props = {
  language: AppLanguage;
  onChangeLanguage: (language: AppLanguage) => void;
  children: (props: {
    language: AppLanguage;
    onChangeLanguage: (language: AppLanguage) => void;
  }) => React.ReactNode;
};

const GeneralSettingsBridge = ({
  language,
  onChangeLanguage,
  children,
}: Props) => <>{children({ language, onChangeLanguage })}</>;

export default GeneralSettingsBridge;
