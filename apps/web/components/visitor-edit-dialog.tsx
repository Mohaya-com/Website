'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { fieldErrorsFromIssues, hasPermission, visitorUpdateSchema, type VisitorFullDTO } from '@vms/shared';
import { api, isApiError } from '@/lib/api';
import { usePublicConfig, useSession } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { DocumentExpiryInput, DocumentNumberInput, NationalitySelect, PhoneInput, expiryFromStored, expiryGregorian, expiryToInput, type ExpiryValue, type PhoneValue } from './inputs';
import { Dialog } from './ui/dialog';
import { Banner } from './ui/feedback';
import { Field, Input, Segmented, Textarea } from './ui/form';
import { Button } from './ui/primitives';

/**
 * Explicit, reasoned profile update. Only changed fields are sent; the server checks each field's permission
 * (identity fields for administrators only) and records a new profile version plus an audit entry.
 */
export function VisitorEditDialog({ visitor, open, onClose, onSaved }: { visitor: VisitorFullDTO; open: boolean; onClose: () => void; onSaved: (v: VisitorFullDTO) => void }) {
  const { t } = useI18n();
  const { data: session } = useSession();
  const { data: config } = usePublicConfig();
  const canIdentity = hasPermission(session?.role, 'visitors.update_identity');
  const national = visitor.mobile.startsWith('+966');
  const [fullName, setFullName] = useState(visitor.fullName);
  const [documentType, setDocumentType] = useState(visitor.documentType);
  const [documentNumber, setDocumentNumber] = useState(visitor.documentNumber);
  const [nationality, setNationality] = useState(visitor.nationality);
  const [expiry, setExpiry] = useState<ExpiryValue>(expiryFromStored(visitor.documentExpiryDate, visitor.documentExpiryCalendar, visitor.documentExpiryOriginal));
  const [phone, setPhone] = useState<PhoneValue>({ country: 'SA', number: national ? `0${visitor.mobile.slice(4)}` : visitor.mobile });
  const [reason, setReason] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ visitor: VisitorFullDTO; changed: string[] }>(`/visitors/${visitor.id}`, { method: 'PATCH', body }),
    onSuccess: (res) => onSaved(res.visitor),
    onError: (err) => {
      if (isApiError(err)) setFields(err.fields);
    },
  });

  function submit() {
    const body: Record<string, unknown> = { expectedVersion: visitor.version, reason };
    if (canIdentity && fullName.trim() !== visitor.fullName) body.fullName = fullName;
    if (canIdentity && (documentNumber !== visitor.documentNumber || documentType !== visitor.documentType)) {
      body.documentType = documentType;
      body.documentNumber = documentNumber;
    }
    if (nationality !== visitor.nationality) body.nationality = nationality;
    if (expiryGregorian(expiry) !== visitor.documentExpiryDate) body.documentExpiry = expiryToInput(expiry);
    const currentLocal = national ? `0${visitor.mobile.slice(4)}` : visitor.mobile;
    if (phone.number.replace(/\s/g, '') !== currentLocal) {
      body.mobile = phone.number;
      body.mobileCountry = phone.country;
    }
    const parsed = visitorUpdateSchema({ checksum: config?.identityChecksumValidation ?? true }).safeParse(body);
    if (!parsed.success) {
      setFields(fieldErrorsFromIssues(parsed.error.issues));
      return;
    }
    setFields({});
    save.mutate(body);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t('admin.profileEditTitle')}
      description={t('admin.profileEditHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.isError && !Object.keys(fields).length && <Banner tone="danger">{isApiError(save.error) ? t.dynamic(save.error.messageKey) : t('errors.internal_error')}</Banner>}
        {!canIdentity && <Banner tone="info">{t('admin.profileEditRestricted')}</Banner>}
        <Field label={t('fields.fullName')} required error={fields.fullName}>
          {(a) => <Input {...a} value={fullName} disabled={!canIdentity} onChange={(e) => setFullName(e.target.value)} />}
        </Field>
        {canIdentity && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('fields.documentType')} required>
              {() => (
                <Segmented
                  label={t('fields.documentType')}
                  value={documentType}
                  onChange={setDocumentType}
                  options={[
                    { value: 'national_id', label: t('documentTypes.national_id') },
                    { value: 'iqama', label: t('documentTypes.iqama') },
                  ]}
                />
              )}
            </Field>
            <DocumentNumberInput value={documentNumber} onChange={setDocumentNumber} error={fields.documentNumber} />
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NationalitySelect value={nationality} onChange={setNationality} error={fields.nationality} />
          <PhoneInput value={phone} onChange={setPhone} error={fields.mobile} />
        </div>
        <DocumentExpiryInput value={expiry} onChange={setExpiry} error={fields['documentExpiry.date'] ?? fields.documentExpiry} />
        <Field label={t('fields.changeReason')} required error={fields.reason}>
          {(a) => <Textarea {...a} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}
