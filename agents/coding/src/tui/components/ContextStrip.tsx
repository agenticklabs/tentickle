import { Box, Text } from "ink";
import { basename } from "node:path";

interface ContextStripProps {
  files: readonly string[];
  focusIndex: number | null;
}

export function ContextStrip({ files, focusIndex }: ContextStripProps) {
  if (files.length === 0) return null;

  const focused = focusIndex !== null;

  return (
    <Box flexDirection="column">
      {focused && focusIndex != null && files[focusIndex] && (
        <Text dimColor> {files[focusIndex]}</Text>
      )}
      <Box flexDirection="row" gap={1} paddingLeft={2}>
        {files.map((file, i) => {
          const selected = focusIndex === i;
          return (
            <Text key={file} inverse={selected} bold={selected} dimColor={!selected}>
              @{basename(file)}
            </Text>
          );
        })}
        {!focused && <Text dimColor> (↑ to select)</Text>}
      </Box>
    </Box>
  );
}
