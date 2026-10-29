import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { fieldErrorsFromIssues, hasPermission, visitorCreateSchema, visitorUpdateSchema, type DocumentType, type VisitorFullDTO } from '@vms/shared';
import { DocumentNumberInput, ExpiryInput, NationalityPicker, PhoneInput, emptyExpiry, expiryFromStored, expiryGregorian, expiryToInput, type ExpiryValue, type PhoneValue } from '@/components/inputs';
import { AppText, Banner, Button, Card, Field, Input, Segmented } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { usePublicConfig } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { space } from '@/lib/theme';

/** Explicit, reasoned and audited profile update. Identity fields are editable by administrators only. */
export function VisitorEditForm({ visitor, onSaved, onCancel }: { visitor: VisitorFullDTO; onSaved: (v: VisitorFullDTO) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const { session } = useSession();
  const { data: config } = usePublicConfig();
  const canIdentity = hasPermission(session?.role, 'visitors.update_identity');
  const saudi = visitor.mobile.startsWith('+966');
  const [fullName, setFullName] = useState(visitor.fullName);
  const [documentType, setDocumentType] = useState<DocumentType>(visitor.documentType);
  const [documentNumber, setDocumentNumber] = useState(visitor.documentNumber);
  const [nationality, setNationality] = useState(visitor.nationality);
  const [expiry, setExpiry] = useState<ExpiryValue>(expiryFromStored(visitor.documentExpiryDate, visitor.documentExpiryCalendar, visitor.documentExpiryOriginal));
  const [phone, setPhone] = useState<PhoneValue>({ country: 'SA', number: saudi ? `0${visitor.mobile.slice(4)}` : visitor.mobile });
  const [reason, setReason] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ visitor: VisitorFullDTO }>(`/visitors/${visitor.id}`, { method: 'PATCH', body }),
    onSuccess: (res) => onSaved(res.visitor),
    onError: (err) => isApiError(err) && setFields(err.fields),
  });

  function submit() {
    const body: Record<string, unknown> = { expectedVersion: visitor.version, reason };
    if (canIdentity && fullName.trim() !== visitor.fullName) body.fullName = fullName;
    if (canIdentity && (documentNumber !== visitor.documentNumber || documentType !== visitor.documentType)) Object.assign(body, { documentType, documentNumber });
    if (nationality !== visitor.nationality) body.nationality = nationality;
    if (expiryGregorian(expiry) !== visitor.documentExpiryDate) body.documentExpiry = expiryToInput(expiry);
    if (phone.number.replace(/\s/g, '') !== (saudi ? `0${visitor.mobile.slice(4)}` : visitor.mobile)) Object.assign(body, { mobile: phone.number, mobileCountry: phone.country });
    const parsed = visitorUpdateSchema({ checksum: config?.identityChecksumValidation ?? true }).safeParse(body);
    if (!parsed.success) return setFields(fieldErrorsFromIssues(parsed.error.issues));
    setFields({});
    save.mutate(body);
  }

  return (
    <Card style={{ gap: space.lg }}>
      <AppText variant="subheading">{t('admin.profileEditTitle')}</AppText>
      <AppText variant="caption">{t('admin.profileEditHint')}</AppText>
      {!canIdentity ? <Banner tone="info">{t('admin.profileEditRestricted')}</Banner> : null}
      {save.isError && !Object.keys(fields).length ? <Banner tone="danger">{isApiError(save.error) ? t.dynamic(save.error.messageKey) : t('errors.internal_error')}</Banner> : null}
      <Field label={t('fields.fullName')} required error={fields.fullName}>
        <Input value={fullName} onChangeText={setFullName} editable={canIdentity} accessibilityLabel={t('fields.fullName')} style={!canIdentity ? { backgroundColor: '#F1F5F9' } : undefined} />
      </Field>
      {canIdentity ? (
        <>
          <Segmented
            label={t('fields.documentType')}
            value={documentType}
            onChange={setDocumentType}
            options={[
              { value: 'national_id', label: t('documentTypes.national_id') },
              { value: 'iqama', label: t('documentTypes.iqama') },
            ]}
          />
          <DocumentNumberInput value={documentNumber} onChange={setDocumentNumber} error={fields.documentNumber} />
        </>
      ) : null}
      <NationalityPicker value={nationality} onChange={setNationality} error={fields.nationality} />
      <PhoneInput value={phone} onChange={setPhone} error={fields.mobile} />
      <ExpiryInput value={expiry} onChange={setExpiry} error={fields['documentExpiry.date'] ?? fields.documentExpiry} />
      <Field label={t('fields.changeReason')} required error={fields.reason}>
        <Input value={reason} onChangeText={setReason} maxLength={300} accessibilityLabel={t('fields.changeReason')} invalid={Boolean(fields.reason)} />
      </Field>
      <View style={{ gap: space.sm }}>
        <Button title={t('common.save')} loading={save.isPending} onPress={submit} />
        <Button title={t('common.cancel')} variant="secondary" onPress={onCancel} />
      </View>
    </Card>
  );
}

/** New visitor profile created by staff (identity data held in memory only). */
export function NewVisitorForm({ documentNumber, onCreated, onDuplicate }: { documentNumber: string; onCreated: (v: VisitorFullDTO) => void; onDuplicate: (n: string) => void }) {
  const { t } = useI18n();
  const { data: config } = usePublicConfig();
  const [documentType, setDocumentType] = useState<DocumentType>(documentNumber.startsWith('2') ? 'iqama' : 'national_id');
  const [number, setNumber] = useState(documentNumber);
  const [fullName, setFullName] = useState('');
  const [nationality, setNationality] = useState(documentNumber.startsWith('1') ? 'SA' : '');
  const [expiry, setExpiry] = useState<ExpiryValue>(emptyExpiry());
  const [phone, setPhone] = useState<PhoneValue>({ country: 'SA', number: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const body = { fullName, documentType, documentNumber: number, documentExpiry: expiryToInput(expiry), nationality, mobile: phone.number, mobileCountry: phone.country };
    const parsed = visitorCreateSchema({ checksum: config?.identityChecksumValidation ?? true }).safeParse(body);
    if (!parsed.success) return setFields(fieldErrorsFromIssues(parsed.error.issues));
    setFields({});
    setBusy(true);
    try {
      onCreated(await api<VisitorFullDTO>('/visitors', { body }));
    } catch (err) {
      if (isApiError(err) && err.code === 'duplicate_visitor') onDuplicate(parsed.data.documentNumber);
      else if (isApiError(err)) {
        setFields(err.fields);
        setError(err.messageKey);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: space.lg }}>
      <AppText variant="subheading">{t('returning.newProfileTitle')}</AppText>
      {error ? <Banner tone="danger">{t.dynamic(error)}</Banner> : null}
      <Segmented
        label={t('fields.documentType')}
        value={documentType}
        onChange={setDocumentType}
        options={[
          { value: 'national_id', label: t('documentTypes.national_id') },
          { value: 'iqama', label: t('documentTypes.iqama') },
        ]}
      />
      <DocumentNumberInput value={number} onChange={setNumber} error={fields.documentNumber} />
      <Field label={t('fields.fullName')} required error={fields.fullName} hint={t('fields.fullNameHint')}>
        <Input value={fullName} onChangeText={setFullName} accessibilityLabel={t('fields.fullName')} invalid={Boolean(fields.fullName)} />
      </Field>
      <NationalityPicker value={nationality} onChange={setNationality} error={fields.nationality} />
      <PhoneInput value={phone} onChange={setPhone} error={fields.mobile} />
      <ExpiryInput value={expiry} onChange={setExpiry} error={fields['documentExpiry.date'] ?? fields.documentExpiry} />
      <Button title={t('returning.createNew')} variant="accent" loading={busy} onPress={() => void submit()} />
    </Card>
  );
}
