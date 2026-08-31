import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar, Form, Input, Stepper, Switch, Button, Toast } from 'antd-mobile';
import { useTranslation } from 'react-i18next';
import { aiApi } from '../../../api';
import type { UserAiConfig } from '../../../types';
import styles from './index.module.css';

const AiConfig = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [maxTokens, setMaxTokens] = useState(4096);
  const [temperature, setTemperature] = useState(0.7);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const res = await aiApi.getConfig();
      if (res.code === 200 && res.data) {
        setBaseUrl(res.data.baseUrl || '');
        setApiKey(res.data.apiKey || '');
        setModel(res.data.model || '');
        setMaxTokens(res.data.maxTokens || 4096);
        setTemperature(res.data.temperature ?? 0.7);
        setEnabled(res.data.enabled !== 0);
      }
    } catch (e) {
      Toast.show({ content: t('common.error') });
    }
  };

  const handleSave = async () => {
    if (!baseUrl.trim()) {
      Toast.show({ content: t('ai.configBaseUrlRequired') });
      return;
    }
    setSaving(true);
    try {
      const config: UserAiConfig = {
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim() || 'hermes-agent',
        maxTokens,
        temperature,
        enabled: enabled ? 1 : 0,
      };
      const res = await aiApi.saveConfig(config);
      if (res.code === 200) {
        Toast.show({ content: t('common.success') });
      } else {
        Toast.show({ content: res.message || t('common.error') });
      }
    } catch (e) {
      Toast.show({ content: t('common.error') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.container}>
      <NavBar onBack={() => navigate(-1)} className={styles.navBar}>
        {t('ai.configTitle')}
      </NavBar>

      <Form className={styles.form} layout="vertical">
        <Form.Item label={t('ai.baseUrl')}>
          <Input
            value={baseUrl}
            onChange={setBaseUrl}
            placeholder="https://api.example.com/v1"
            className={styles.input}
          />
        </Form.Item>

        <Form.Item label={t('ai.apiKey')}>
          <Input
            value={apiKey}
            onChange={setApiKey}
            placeholder="sk-..."
            className={styles.input}
          />
        </Form.Item>

        <Form.Item label={t('ai.model')}>
          <Input
            value={model}
            onChange={setModel}
            placeholder={t('ai.modelPlaceholder')}
            className={styles.input}
          />
        </Form.Item>

        <Form.Item label={t('ai.maxTokens')}>
          <Stepper min={64} max={8192} step={64} value={maxTokens} onChange={setMaxTokens} />
        </Form.Item>

        <Form.Item label={t('ai.temperature')}>
          <Stepper min={0} max={2} step={0.1} value={temperature} onChange={setTemperature} />
        </Form.Item>

        <Form.Item label={t('ai.enabled')}>
          <Switch checked={enabled} onChange={setEnabled} />
        </Form.Item>
      </Form>

      <div className={styles.footer}>
        <Button
          block
          color="primary"
          size="large"
          loading={saving}
          onClick={handleSave}
          className={styles.saveBtn}
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
};

export default AiConfig;
