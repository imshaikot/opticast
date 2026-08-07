import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ReceivedFile } from '../lib/receivedFile';
import { formatDuration, theme } from '../theme';

/** Each player is its own component: the player hooks cannot be conditional. */
export function FilePreview({ file }: { file: ReceivedFile }) {
  if (file.kind === 'image') return <ImagePreview file={file} />;
  if (file.kind === 'video') return <VideoPreview file={file} />;
  if (file.kind === 'audio') return <AudioPreview file={file} />;
  return (
    <View style={styles.placeholder}>
      <Text style={styles.placeholderIcon}>📄</Text>
      <Text style={styles.placeholderText}>No inline preview for {file.mime}</Text>
    </View>
  );
}

function ImagePreview({ file }: { file: ReceivedFile }) {
  return (
    <Image
      source={{ uri: file.uri }}
      style={styles.media}
      contentFit="contain"
      transition={150}
    />
  );
}

function VideoPreview({ file }: { file: ReceivedFile }) {
  const player = useVideoPlayer({ uri: file.uri }, (instance) => {
    instance.loop = true;
  });
  return <VideoView style={styles.media} player={player} nativeControls />;
}

function AudioPreview({ file }: { file: ReceivedFile }) {
  const player = useAudioPlayer({ uri: file.uri });
  const status = useAudioPlayerStatus(player);

  return (
    <View style={styles.audio}>
      <Text style={styles.audioIcon}>🎵</Text>
      <Pressable
        style={styles.audioButton}
        onPress={() => (status.playing ? player.pause() : player.play())}
      >
        <Text style={styles.audioButtonText}>
          {status.playing ? '⏸ Pause' : '▶ Play'}
        </Text>
      </Pressable>
      <Text style={styles.audioTime}>
        {formatDuration(status.currentTime)} / {formatDuration(status.duration)}
      </Text>
    </View>
  );
}

// Every branch fills whatever container it is given; the scan frame owns the
// size and the rounded clipping.
const styles = StyleSheet.create({
  media: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  placeholder: {
    flex: 1,
    backgroundColor: theme.panel,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  placeholderIcon: {
    fontSize: 44,
  },
  placeholderText: {
    color: theme.muted,
    fontSize: 13,
  },
  audio: {
    flex: 1,
    backgroundColor: theme.panel2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  audioIcon: {
    fontSize: 30,
  },
  audioButton: {
    paddingVertical: 8,
    paddingHorizontal: 22,
    borderRadius: 999,
    backgroundColor: theme.accent,
  },
  audioButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  audioTime: {
    color: theme.muted,
    fontSize: 12,
  },
});
