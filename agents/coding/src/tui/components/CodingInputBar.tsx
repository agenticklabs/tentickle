import React, { useCallback } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export function CodingInputBar({
  value,
  onChange,
  onSubmit,
  isDisabled = false,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string) => void;
  isDisabled?: boolean;
  placeholder?: string;
}) {
  const handleSubmit = useCallback(
    (text: string) => {
      if (!text.trim() || isDisabled) return;
      onSubmit(text.trim());
      onChange("");
    },
    [onSubmit, onChange, isDisabled],
  );

  return (
    <Box borderStyle="single" borderColor={isDisabled ? "gray" : "cyan"} paddingLeft={1}>
      <Text color={isDisabled ? "gray" : "green"} bold>
        {"› "}
      </Text>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={handleSubmit}
        focus={!isDisabled}
        placeholder={placeholder ?? (isDisabled ? "Waiting..." : "Describe what you need...")}
      />
    </Box>
  );
}
