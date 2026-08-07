import { WrongPinError, type StreamMetadata } from '@opticast/protocol';
import { useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PinPrompt } from '../components/PinPrompt';
import { ScanLayout } from '../components/ScanLayout';
import { useStreamAssembler } from '../hooks/useStreamAssembler';
import { trackInProgress } from '../lib/fileRegistry';
import {
  discardReceivedFile,
  writeReceivedFile,
  type ReceivedFile,
} from '../lib/receivedFile';
import { FilesScreen } from '../screens/FilesScreen';
import { ResultScreen } from '../screens/ResultScreen';
import { ScannerScreen } from '../screens/ScannerScreen';
import { theme } from '../theme';

type Phase =
  | 'idle'
  /** Camera live, collecting barcodes. */
  | 'scanning'
  /** Every frame is in, but the stream is encrypted and no PIN is known yet. */
  | 'awaiting-pin'
  | 'decrypting'
  | 'ready'
  | 'error';

export function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const { progress, ingest, finalize, reset } = useStreamAssembler();

  const [phase, setPhase] = useState<Phase>('idle');
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<ReceivedFile | null>(null);
  const [showFiles, setShowFiles] = useState(false);

  // In refs because `onBarcodeScanned` is handed to the native camera view and
  // fires many times per second; state would mean stale closures or a new
  // callback every render.
  const pinRef = useRef<string | null>(null);
  const completedRef = useRef(false);
  const metadataRef = useRef<StreamMetadata | null>(null);
  metadataRef.current = progress.metadata;

  const ratioRef = useRef(0);
  ratioRef.current = progress.ratio;

  // Keeps the registry fresh at 5% steps, so a scan is not writing JSON on
  // every throttled progress push.
  const lastTrackedRef = useRef(-1);
  useEffect(() => {
    const metadata = progress.metadata;
    if (!metadata || (phase !== 'scanning' && phase !== 'awaiting-pin')) return;
    if (
      lastTrackedRef.current >= 0 &&
      progress.ratio - lastTrackedRef.current < 0.05
    )
      return;
    lastTrackedRef.current = progress.ratio;
    trackInProgress(metadata, progress.ratio);
  }, [progress.metadata, progress.ratio, phase]);

  const runFinalize = useCallback(
    async (metadata: StreamMetadata, pin: string | null) => {
      setPhase('decrypting');
      setPinError(null);
      try {
        const bytes = await finalize(pin);
        setResult(writeReceivedFile(bytes, metadata));
        setPhase('ready');
      } catch (error) {
        if (error instanceof WrongPinError) {
          // Every frame is still buffered, so the user can try again.
          pinRef.current = null;
          setPinError('That PIN did not work. Try again.');
          setPhase('awaiting-pin');
          setPinModalOpen(true);
          return;
        }
        setFailure(error instanceof Error ? error.message : String(error));
        setPhase('error');
      }
    },
    [finalize],
  );

  const handleBarcode = useCallback(
    (scan: BarcodeScanningResult) => {
      if (completedRef.current) return;
      if (!ingest(scan.data)) return;

      const metadata = metadataRef.current;
      if (!metadata) return;

      completedRef.current = true;

      if (metadata.encryption && !pinRef.current) {
        setPhase('awaiting-pin');
        setPinModalOpen(true);
        return;
      }
      void runFinalize(metadata, pinRef.current);
    },
    [ingest, runFinalize],
  );

  const handlePinSubmit = useCallback(
    (pin: string) => {
      pinRef.current = pin;
      setPinModalOpen(false);
      // Entered mid-scan: remember it and keep collecting frames.
      if (!completedRef.current) return;
      const metadata = metadataRef.current;
      if (metadata) void runFinalize(metadata, pin);
    },
    [runFinalize],
  );

  const startOver = useCallback(() => {
    completedRef.current = false;
    pinRef.current = null;
    lastTrackedRef.current = -1;
    setPinError(null);
    setFailure(null);
    setResult(null);
    reset();
    setPhase('scanning');
  }, [reset]);

  const stop = useCallback(() => {
    // An abandoned scan keeps its last position; a completed one must not
    // resurrect as in-progress.
    const metadata = metadataRef.current;
    if (metadata && !completedRef.current) {
      trackInProgress(metadata, ratioRef.current);
    }
    completedRef.current = false;
    pinRef.current = null;
    lastTrackedRef.current = -1;
    setPinModalOpen(false);
    setPinError(null);
    setFailure(null);
    reset();
    setPhase('idle');
  }, [reset]);

  const beginScanning = useCallback(async () => {
    if (!permission?.granted) {
      const next = await requestPermission();
      if (!next.granted) return;
    }
    startOver();
  }, [permission, requestPermission, startOver]);

  if (showFiles) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <FilesScreen onClose={() => setShowFiles(false)} />
      </View>
    );
  }

  if (phase === 'ready' && result && progress.metadata) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <ResultScreen
          file={result}
          metadata={progress.metadata}
          onScanAnother={startOver}
          onDiscard={() => {
            discardReceivedFile(result);
            stop();
          }}
        />
      </View>
    );
  }

  const scanning = phase === 'scanning' || phase === 'awaiting-pin';

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {scanning ? (
        <ScannerScreen
          progress={progress}
          onBarcodeScanned={handleBarcode}
          onEnterPin={() => setPinModalOpen(true)}
          onCancel={stop}
          pinReady={pinRef.current !== null}
        />
      ) : phase === 'decrypting' ? (
        <ScanLayout
          border={{ color: theme.ok, width: 3 }}
          preview={
            <View style={styles.busyPreview}>
              <ActivityIndicator size="large" color={theme.accent} />
            </View>
          }
        >
          <Text style={styles.busyTitle}>
            {progress.metadata?.encryption ? 'Decrypting…' : 'Verifying…'}
          </Text>
          <Text style={styles.busySubtitle}>
            {progress.metadata?.encryption
              ? `Deriving the key (${progress.metadata.encryption.iterations.toLocaleString()} rounds), then checking the file`
              : 'Checking the file against its checksum'}
          </Text>
        </ScanLayout>
      ) : (
        <SafeAreaView style={styles.centered}>
          <Text style={styles.logo}>▦</Text>
          <Text style={styles.title}>opticast</Text>
          <Text style={styles.tagline}>
            Point the camera at a barcode video to pull the file back out of it.
          </Text>

          {phase === 'error' && failure && (
            <Text style={styles.error}>{failure}</Text>
          )}

          {permission && !permission.granted && !permission.canAskAgain && (
            <Text style={styles.error}>
              Camera access is off. Enable it in Settings to scan.
            </Text>
          )}

          <Pressable style={styles.cta} onPress={beginScanning}>
            <Text style={styles.ctaText}>
              {phase === 'error' ? 'Try again' : 'Capture a File'}
            </Text>
          </Pressable>

          <Pressable
            style={styles.secondary}
            onPress={() => setShowFiles(true)}
          >
            <Text style={styles.secondaryText}>Manage Files</Text>
          </Pressable>
        </SafeAreaView>
      )}

      <PinPrompt
        visible={pinModalOpen}
        fileName={progress.metadata?.file.name}
        error={pinError}
        onSubmit={handlePinSubmit}
        onCancel={() => {
          setPinModalOpen(false);
          // Backing out with every frame collected would strand the user.
          if (phase === 'awaiting-pin') stop();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 10,
  },
  logo: {
    fontSize: 46,
    color: theme.accent,
  },
  title: {
    color: theme.text,
    fontSize: 24,
    fontWeight: '700',
  },
  tagline: {
    color: theme.muted,
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 300,
  },
  error: {
    color: theme.danger,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
  },
  cta: {
    marginTop: 18,
    backgroundColor: theme.accent,
    paddingVertical: 14,
    paddingHorizontal: 34,
    borderRadius: 999,
  },
  ctaText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  secondary: {
    marginTop: 4,
    paddingVertical: 12,
    paddingHorizontal: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
  },
  secondaryText: {
    color: theme.muted,
    fontWeight: '600',
    fontSize: 14,
  },
  busyPreview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busyTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '600',
  },
  busySubtitle: {
    color: theme.muted,
    fontSize: 13,
    marginTop: 6,
  },
});

export default App;
