import React from "react";
import { Box, Text } from "ink";
import type { Attachment } from "@agentick/client";

interface AttachmentStripProps {
  attachments: readonly Attachment[];
  focusIndex: number | null;
}

export function AttachmentStrip({ attachments, focusIndex }: AttachmentStripProps) {
  if (attachments.length === 0) return null;

  const focused = focusIndex !== null;

  return (
    <Box flexDirection="column">
      {focused && focusIndex != null && attachments[focusIndex] && (
        <Text dimColor> file://{getSourcePath(attachments[focusIndex])}</Text>
      )}
      <Box flexDirection="row" gap={1} paddingLeft={2}>
        {attachments.map((att, i) => {
          const selected = focusIndex === i;
          return (
            <Text key={att.id} inverse={selected} bold={selected} dimColor={!selected}>
              [{att.name}]
            </Text>
          );
        })}
        {!focused && <Text dimColor> (↑ to select)</Text>}
      </Box>
    </Box>
  );
}

function getSourcePath(att: Attachment): string {
  return att.name;
}
