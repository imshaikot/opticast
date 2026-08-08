import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { formatClock } from './format';

interface Props {
  src: string;
  /** Shown in the bezel strip — the geometry a scanner is pointing at. */
  label: string;
}

/**
 * A VCR-style transport deck around a bare `<video>`.
 *
 * The native controls are dropped rather than restyled: they are shadow DOM
 * and the parts that can be reached vary by browser. Nothing is lost — the
 * encoder produces no audio track, so volume is moot, and fullscreen is put
 * back as an explicit key because it is the one control that actually helps a
 * scan (a bigger barcode is a readable barcode).
 */
export function RetroPlayer({ src, label }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loop, setLoop] = useState(true);

  // Autoplay can be refused. Start it here but let the element's own events
  // set `playing`, or the transport claims to be running while it is paused.
  useEffect(() => {
    void ref.current?.play().catch(() => undefined);
  }, []);

  const toggle = () => {
    const video = ref.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };

  const stop = () => {
    const video = ref.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
    setTime(0);
  };

  const seek = (seconds: number) => {
    const video = ref.current;
    if (!video) return;
    video.currentTime = seconds;
    setTime(seconds);
  };

  const goFullscreen = () => {
    // Safari on iOS only has the prefixed video-element form.
    const video = ref.current as
      | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      | null;
    if (!video) return;
    if (video.requestFullscreen) void video.requestFullscreen().catch(() => undefined);
    else video.webkitEnterFullscreen?.();
  };

  const ratio = duration > 0 ? Math.min(time / duration, 1) : 0;

  return (
    <div className="crt">
      <div className="crt-head">
        <i className={`led${playing ? ' led-on' : ''}`} />
        <span>{playing ? 'Playing' : 'Paused'}</span>
        <span className="crt-head-tag">{label}</span>
      </div>

      <div className="crt-screen">
        <video
          ref={ref}
          src={src}
          loop={loop}
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => {
            const seconds = event.currentTarget.duration;
            setDuration(Number.isFinite(seconds) ? seconds : 0);
          }}
        />
      </div>

      <div className="transport">
        <div className="transport-track">
          <input
            className="scrub"
            type="range"
            min={0}
            max={duration || 0}
            step={0.05}
            value={Math.min(time, duration || 0)}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label="Seek"
            style={{ '--fill': `${ratio * 100}%` } as CSSProperties}
          />
          <span className="clock">
            {formatClock(time)} / {formatClock(duration)}
          </span>
        </div>

        <div className="transport-keys">
          <button
            type="button"
            className="key"
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            <span className="glyph">{playing ? '❚❚' : '▶'}</span>
            {playing ? 'Pause' : 'Play'}
          </button>

          <button type="button" className="key" onClick={stop} aria-label="Stop">
            <span className="glyph">■</span>
            Stop
          </button>

          <button
            type="button"
            className={`key key-toggle${loop ? ' on' : ''}`}
            onClick={() => setLoop((previous) => !previous)}
            aria-pressed={loop}
          >
            Loop {loop ? 'On' : 'Off'}
          </button>

          <button
            type="button"
            className="key"
            onClick={goFullscreen}
            aria-label="Fullscreen"
          >
            <span className="glyph">⛶</span>
            Full
          </button>
        </div>
      </div>
    </div>
  );
}
