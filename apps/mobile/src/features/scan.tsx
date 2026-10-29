import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Camera, CheckCircle2, CircleSlash, Flashlight, FlashlightOff, Keyboard, LogIn, LogOut, RotateCcw, Search, ShieldAlert, VideoOff, XCircle } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, View } from 'react-native';
import { SUCCESS_SCAN_CODES, extractPassToken, normalizeIdentifier, parseGateUrl, type GateAction, type GateDTO, type ScanResultDTO, type VisitDTO } from '@vms/shared';
import { SelectSheet } from '@/components/inputs';
import { AppText, Banner, Button, Card, Checkbox, Detail, DetailGrid, Input, Row, Segmented } from '@/components/ui';
import { DocBadge, VisitCard, useVisitLabels } from '@/components/visit';
import { api, isApiError } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useOnline } from '@/lib/network';
import { colors, flipX, ltr, radius, space } from '@/lib/theme';

const GATE_KEY = 'vms.scan.gate';

type Phase = { kind: 'idle' } | { kind: 'verifying' } | { kind: 'result'; result: ScanResultDTO; input: { qr?: string; visitId?: string } } | { kind: 'confirming'; result: ScanResultDTO; input: { qr?: string; visitId?: string } };

function notify(ok: boolean) {
  if (Platform.OS === 'web') return;
  void Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => undefined);
}

function CheckRow({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return null;
  return (
    <Row gap={6}>
      {ok ? <CheckCircle2 size={18} color={colors.green700} /> : <XCircle size={18} color={colors.red700} />}
      <AppText weight="bold" style={{ color: ok ? colors.green700 : colors.red700 }}>
        {label}
      </AppText>
    </Row>
  );
}

/** Server decision + identity details for visual comparison + explicit confirmation. */
export function ScanResultView({ result, onConfirm, confirming, onReset, online }: { result: ScanResultDTO; onConfirm: (identityConfirmed: boolean) => void; confirming: boolean; onReset: () => void; online: boolean }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  const [identityChecked, setIdentityChecked] = useState(false);
  const success = SUCCESS_SCAN_CODES.includes(result.code);
  const recorded = result.code === 'entry_recorded' || result.code === 'exit_recorded';
  const canConfirm = result.ok && !recorded;
  const v = result.visit;
  const p = result.visitor;
  const bg = recorded ? colors.green700 : success ? colors.teal700 : colors.red700;
  const Icon = recorded ? CheckCircle2 : success ? (result.action === 'entry' ? LogIn : LogOut) : result.code === 'identity_not_confirmed' ? ShieldAlert : CircleSlash;

  return (
    <View style={{ gap: space.md }}>
      <View accessibilityRole={success ? 'summary' : 'alert'} accessibilityLiveRegion="assertive" style={{ backgroundColor: bg, borderRadius: radius.lg, padding: space.lg, flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
        <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={30} color={colors.white} style={Icon === LogIn || Icon === LogOut ? flipX() : undefined} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="small" style={{ color: 'rgba(255,255,255,0.85)' }}>
            {`${t(result.action === 'entry' ? 'scan.entry' : 'scan.exit')} · ${labels.gate(result.gate)}`}
          </AppText>
          <AppText weight="extrabold" style={{ color: colors.white, fontSize: 18, lineHeight: 28 }}>
            {t(`scan.codes.${result.code}`)}
          </AppText>
          {result.recordedAt ? <AppText variant="small" style={{ color: colors.white }}>{fmt.dateTime(result.recordedAt)}</AppText> : null}
        </View>
      </View>

      {v ? (
        <Card style={{ gap: 6 }}>
          <CheckRow ok={result.checks.approved} label={t('scan.checks.approved')} />
          <CheckRow ok={result.checks.passActive} label={t('scan.checks.pass')} />
          <CheckRow ok={result.checks.withinWindow} label={t('scan.checks.window')} />
          <CheckRow ok={result.checks.documentValid} label={t('scan.checks.document')} />
        </Card>
      ) : null}

      {p ? (
        <Card style={{ gap: space.md }}>
          <AppText variant="subheading">{t('scan.verifyIdentityTitle')}</AppText>
          <DetailGrid>
            <Detail label={t('fields.fullName')} value={<AppText variant="heading">{p.fullName}</AppText>} wide />
            <Detail label={t('fields.documentType')} value={t(`documentTypes.${p.documentType}`)} />
            <Detail label={t('fields.documentNumber')} value={<AppText weight="extrabold" style={{ fontSize: 18, letterSpacing: 1 }}>{ltr(p.documentNumber)}</AppText>} />
            <Detail label={t('fields.nationality')} value={labels.nationality(p.nationality)} />
            <Detail
              label={t('fields.documentExpiry')}
              value={
                <View style={{ gap: 4 }}>
                  <AppText weight="bold">{fmt.ymd(p.documentExpiryDate)}</AppText>
                  <DocBadge expired={p.documentExpired} />
                </View>
              }
            />
          </DetailGrid>
        </Card>
      ) : null}

      {v ? (
        <Card style={{ gap: space.md }}>
          <AppText variant="subheading">{t('scan.visitDetails')}</AppText>
          <DetailGrid>
            <Detail label={t('fields.reference')} value={ltr(v.reference)} />
            <Detail label={t('fields.villa')} value={<AppText variant="heading">{ltr(v.villa.number)}</AppText>} />
            <Detail label={t('fields.reason')} value={labels.reason(v)} wide />
            {v.entryWindowStart && v.entryWindowEnd ? <Detail label={t('fields.entryWindow')} value={`${fmt.time(v.entryWindowStart)} – ${fmt.time(v.entryWindowEnd)}`} /> : null}
            <Detail label={t('fields.expectedExit')} value={fmt.dateTime(v.expectedExitAt)} />
          </DetailGrid>
        </Card>
      ) : null}

      {canConfirm ? (
        <View style={{ gap: space.md, borderWidth: 2, borderColor: colors.teal100, backgroundColor: colors.teal50, borderRadius: radius.lg, padding: space.md }}>
          {result.action === 'entry' ? <Checkbox checked={identityChecked} onChange={setIdentityChecked} label={t('scan.identityCheck')} /> : null}
          <Button
            title={confirming ? t('scan.recording') : result.action === 'entry' ? t('scan.confirmEntry') : t('scan.confirmExit')}
            variant={result.action === 'entry' ? 'success' : 'primary'}
            size="lg"
            loading={confirming}
            disabled={!online || (result.action === 'entry' && !identityChecked)}
            icon={result.action === 'entry' ? <LogIn size={22} color={colors.white} style={flipX()} /> : <LogOut size={22} color={colors.white} style={flipX()} />}
            onPress={() => onConfirm(identityChecked)}
          />
          {!online ? <AppText weight="bold" style={{ color: colors.amber800 }}>{t('scan.offlineBlocked')}</AppText> : null}
        </View>
      ) : null}
      <Button title={t('scan.scanAgain')} variant="secondary" size="lg" icon={<RotateCcw size={20} color={colors.navy900} />} onPress={onReset} />
    </View>
  );
}

/**
 * Gate scanner: choose gate + action, scan with the camera (or look up manually), verify on the server,
 * then explicitly confirm. Never authorizes from cached data or while offline.
 */
export function ScanScreenContent({ initialAction, initialGateCode, initialQr, initialVisitId }: { initialAction?: GateAction; initialGateCode?: string; initialQr?: string; initialVisitId?: string }) {
  const { t, locale } = useI18n();
  const online = useOnline();
  const [permission, requestPermission] = useCameraPermissions();
  const gates = useQuery({ queryKey: ['gates', false], queryFn: () => api<{ items: GateDTO[] }>('/gates'), staleTime: 60_000 });
  const [gateId, setGateId] = useState('');
  const [gatePicker, setGatePicker] = useState(false);
  const [action, setAction] = useState<GateAction>(initialAction ?? 'entry');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [manual, setManual] = useState('');
  const [candidates, setCandidates] = useState<VisitDTO[] | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const busy = useRef(false);
  const last = useRef<{ value: string; at: number } | null>(null);
  const handledInitial = useRef(false);

  const gateList = gates.data?.items.filter((g) => (action === 'entry' ? g.supportsEntry : g.supportsExit)) ?? [];
  const gate = gates.data?.items.find((g) => g.id === gateId);

  useEffect(() => {
    if (!gates.data || gateId) return;
    void AsyncStorage.getItem(GATE_KEY).then((saved) => {
      const fromCode = initialGateCode ? gates.data.items.find((g) => g.code === initialGateCode) : undefined;
      const pick = fromCode ?? gates.data.items.find((g) => g.id === saved) ?? gates.data.items[0];
      if (pick) setGateId(pick.id);
    });
  }, [gates.data, gateId, initialGateCode]);

  useEffect(() => {
    if (gateId) void AsyncStorage.setItem(GATE_KEY, gateId).catch(() => undefined);
  }, [gateId]);

  const verify = useCallback(
    async (input: { qr?: string; visitId?: string }) => {
      if (busy.current) return;
      setError(null);
      if (!online) return setError('scan.offlineBlocked');
      if (!gateId) return setError('scan.gateRequired');
      busy.current = true;
      setPhase({ kind: 'verifying' });
      try {
        const result = await api<ScanResultDTO>('/scan/verify', { body: { ...input, gateId, action } });
        setPhase({ kind: 'result', result, input });
        notify(result.ok);
      } catch (err) {
        setError(isApiError(err) ? err.messageKey : 'errors.internal_error');
        setPhase({ kind: 'idle' });
      } finally {
        busy.current = false;
      }
    },
    [online, gateId, action],
  );

  useEffect(() => {
    if (handledInitial.current || !gateId) return;
    if (initialQr) {
      handledInitial.current = true;
      void verify({ qr: initialQr });
    } else if (initialVisitId) {
      handledInitial.current = true;
      void verify({ visitId: initialVisitId });
    }
  }, [gateId, initialQr, initialVisitId, verify]);

  const onScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (phase.kind !== 'idle' || busy.current) return;
      const now = Date.now();
      // Suppress repeated detections of the same code by the camera.
      if (last.current && last.current.value === data && now - last.current.at < 4000) return;
      last.current = { value: data, at: now };
      const gateLink = parseGateUrl(data);
      if (gateLink && !extractPassToken(data)) {
        const g = gates.data?.items.find((x) => x.code === gateLink.code);
        if (g) {
          setGateId(g.id);
          setAction(gateLink.action);
          setNotice(t('scan.gateQrDetected', { gate: locale === 'ar' ? g.nameAr : g.nameEn, action: t(gateLink.action === 'entry' ? 'scan.entry' : 'scan.exit') }));
        }
        return;
      }
      void verify({ qr: data });
    },
    [phase.kind, gates.data, t, locale, verify],
  );

  async function confirm(identityConfirmed: boolean) {
    if (phase.kind !== 'result' || busy.current) return;
    if (!online) return setError('scan.offlineBlocked');
    busy.current = true;
    const { input, result } = phase;
    setPhase({ kind: 'confirming', result, input });
    try {
      const confirmed = await api<ScanResultDTO>('/scan/confirm', { body: { ...input, gateId, action, identityConfirmed } });
      setPhase({ kind: 'result', result: confirmed, input });
      notify(confirmed.ok);
    } catch (err) {
      setError(isApiError(err) ? err.messageKey : 'errors.internal_error');
      setPhase({ kind: 'result', result, input });
    } finally {
      busy.current = false;
    }
  }

  async function lookup() {
    const q = normalizeIdentifier(manual);
    if (q.length < 3) return;
    setLookupBusy(true);
    setError(null);
    try {
      const res = await api<{ items: VisitDTO[] }>('/scan/lookup', { body: { query: q, action } });
      setCandidates(res.items);
    } catch (err) {
      setError(isApiError(err) ? err.messageKey : 'errors.internal_error');
    } finally {
      setLookupBusy(false);
    }
  }

  const reset = () => {
    setPhase({ kind: 'idle' });
    setCandidates(null);
    setManual('');
    setError(null);
    last.current = null;
  };

  if (phase.kind === 'result' || phase.kind === 'confirming') {
    return (
      <View style={{ gap: space.md }}>
        {error ? <Banner tone="danger">{t.dynamic(error)}</Banner> : null}
        <ScanResultView key={`${phase.result.visit?.id ?? 'x'}-${phase.result.code}`} result={phase.result} confirming={phase.kind === 'confirming'} onConfirm={(c) => void confirm(c)} onReset={reset} online={online} />
      </View>
    );
  }

  const cameraBlock = (() => {
    if (Platform.OS === 'web') return <Banner tone="info">{t('scan.webCameraUnsupported')}</Banner>;
    if (!permission) return <ActivityIndicator color={colors.teal600} />;
    if (!permission.granted) {
      return (
        <Card style={{ alignItems: 'center', gap: space.md, backgroundColor: colors.navy900, borderColor: colors.navy900 }}>
          {permission.canAskAgain ? <Camera size={36} color={colors.teal500} /> : <VideoOff size={36} color={colors.navy200} />}
          <AppText variant="subheading" align="center" style={{ color: colors.white }}>
            {t('scan.cameraPermissionTitle')}
          </AppText>
          <AppText variant="caption" align="center" style={{ color: colors.navy100 }}>
            {permission.canAskAgain ? t('scan.cameraPermissionBody') : t('scan.cameraDenied')}
          </AppText>
          {permission.canAskAgain ? (
            <Button title={t('scan.allowCamera')} variant="accent" icon={<Camera size={18} color={colors.white} />} onPress={() => void requestPermission()} />
          ) : (
            <Button title={t('scan.openSettings')} variant="accent" onPress={() => void Linking.openSettings()} />
          )}
        </Card>
      );
    }
    if (!cameraOn) return <Button title={t('scan.startCamera')} variant="accent" icon={<Camera size={18} color={colors.white} />} onPress={() => setCameraOn(true)} />;
    return (
      <View style={{ borderRadius: radius.lg, overflow: 'hidden', aspectRatio: 1, backgroundColor: colors.navy950 }}>
        <CameraView style={{ flex: 1 }} facing="back" enableTorch={torch} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={phase.kind === 'idle' && gateId ? onScanned : undefined} />
        <View pointerEvents="none" style={{ position: 'absolute', top: '14%', bottom: '14%', start: '14%', end: '14%', borderWidth: 3, borderColor: colors.teal500, borderRadius: 22 }} />
        {phase.kind === 'verifying' ? (
          <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(6,18,36,0.55)', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <ActivityIndicator color={colors.white} size="large" />
            <AppText weight="bold" style={{ color: colors.white }}>
              {t('scan.verifying')}
            </AppText>
          </View>
        ) : null}
        <AppText weight="bold" align="center" style={{ position: 'absolute', bottom: 10, start: 0, end: 0, color: colors.white }}>
          {t('scan.pointCamera')}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={torch ? t('scan.torchOff') : t('scan.torchOn')}
          onPress={() => setTorch((s) => !s)}
          style={{ position: 'absolute', top: 12, end: 12, width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}
        >
          {torch ? <FlashlightOff size={22} color={colors.white} /> : <Flashlight size={22} color={colors.white} />}
        </Pressable>
      </View>
    );
  })();

  return (
    <View style={{ gap: space.md }}>
      <Segmented
        label={t('scan.selectAction')}
        value={action}
        onChange={(a) => {
          setAction(a);
          reset();
        }}
        options={[
          { value: 'entry', label: t('scan.entry'), icon: <LogIn size={16} color={colors.navy700} style={flipX()} /> },
          { value: 'exit', label: t('scan.exit'), icon: <LogOut size={16} color={colors.navy700} style={flipX()} /> },
        ]}
      />
      <Pressable accessibilityRole="button" accessibilityLabel={t('scan.selectGate')} onPress={() => setGatePicker(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.white, paddingHorizontal: space.md }}>
        <AppText variant="small">{t('scan.selectGate')}:</AppText>
        <AppText weight="bold" style={{ flex: 1 }}>
          {gate ? (locale === 'ar' ? gate.nameAr : gate.nameEn) : gates.isLoading ? t('common.loading') : '—'}
        </AppText>
      </Pressable>
      <SelectSheet visible={gatePicker} onClose={() => setGatePicker(false)} title={t('scan.selectGate')} value={gateId} onSelect={setGateId} searchable={false} options={gateList.map((g) => ({ value: g.id, label: locale === 'ar' ? g.nameAr : g.nameEn }))} />
      {notice ? <Banner tone="info">{notice}</Banner> : null}
      {error ? <Banner tone="danger">{t.dynamic(error)}</Banner> : null}
      {!online ? <Banner tone="warning">{t('scan.offlineBlocked')}</Banner> : null}
      {cameraBlock}
      <Card style={{ gap: space.sm }}>
        <Row gap={6}>
          <Keyboard size={18} color={colors.navy700} />
          <AppText variant="subheading">{t('scan.manualLookup')}</AppText>
        </Row>
        <AppText variant="caption">{t('scan.manualLookupHint')}</AppText>
        <Row>
          <Input value={manual} onChangeText={setManual} placeholder={t('scan.manualPlaceholder')} autoCapitalize="characters" accessibilityLabel={t('scan.manualLookup')} ltrInput style={{ flex: 1 }} onSubmitEditing={() => void lookup()} returnKeyType="search" />
          <Button title={t('common.search')} loading={lookupBusy} onPress={() => void lookup()} icon={<Search size={18} color={colors.white} />} />
        </Row>
        {candidates ? (
          candidates.length === 0 ? (
            <AppText variant="caption">{t('scan.manualNoMatch')}</AppText>
          ) : (
            candidates.map((c) => <VisitCard key={c.id} visit={c} showVisitor onPress={() => void verify({ visitId: c.id })} />)
          )
        ) : null}
      </Card>
      {cameraOn && permission?.granted && Platform.OS !== 'web' ? <Button title={t('scan.stopCamera')} variant="ghost" size="sm" onPress={() => setCameraOn(false)} /> : null}
    </View>
  );
}
