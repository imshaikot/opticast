import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet, Text, View } from 'react-native';

import type { ReceivedFile } from '../lib/receivedFile';
import { fonts, formatDuration, theme } from '../theme';
import { Key } from './Chassis';

/** Each player is its own component: the player hooks cannot be conditional. */
export function FilePreview({ file }: { file: ReceivedFile }) {
  if (file.kind === 'image') return <ImagePreview file={file} />;
  if (file.kind === 'video') return <VideoPreview file={file} />;
  if (file.kind === 'audio') return <AudioPreview file={file} />;
  return (
    <View style={styles.placeholder}>
      <Text style={styles.placeholderIcon}>▤</Text>
      <Text style={styles.placeholderText}>
        No inline preview for {file.mime}
      </Text>
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
      <Text style={styles.audioIcon}>♪</Text>
      <Key
        compact
        label={status.playing ? '❚❚ Pause' : '▶ Play'}
        onPress={() => (status.playing ? player.pause() : player.play())}
        style={styles.audioButton}
      />
      <Text style={styles.audioTime}>
        {formatDuration(status.currentTime)} / {formatDuration(status.duration)}
      </Text>
    </View>
  );
}

// Every branch fills whatever container it is given; the scan frame owns the
// size and the glass clipping. Text here sits on the dark screen, so it is
// drawn in phosphor rather than the case inks.
const styles = StyleSheet.create({
  media: {
    width: '100%',
    height: '100%',
    backgroundColor: theme.screen,
  },
  placeholder: {
    flex: 1,
    backgroundColor: theme.screen,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 20,
  },
  placeholderIcon: {
    fontSize: 40,
    lineHeight: 46,
    color: theme.phosphor,
  },
  placeholderText: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: theme.phosphor,
    textAlign: 'center',
  },
  audio: {
    flex: 1,
    backgroundColor: theme.screen,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  audioIcon: {
    fontSize: 34,
    lineHeight: 40,
    color: theme.phosphor,
  },
  audioButton: {
    minWidth: 128,
  },
  audioTime: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: theme.phosphor,
  },
});
