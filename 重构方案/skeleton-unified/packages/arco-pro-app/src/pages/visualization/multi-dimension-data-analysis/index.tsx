import React, { useState, useEffect } from 'react';
import { Typography, Card, Grid, Space } from '@arco-design/web-react';
import axios from 'axios';
import useLocale from '@/utils/useLocale';
import HorizontalInterval from '@/components/Chart/horizontal-interval';
import AreaPolar from '@/components/Chart/area-polar';
import FactMultiPie from '@/components/Chart/fact-multi-pie';
import locale from './locale';
import DataOverview from './data-overview';
import CardList from './card-list';

import './mock';
import { Skeleton } from '@skeleton/renderer-react'
import arcoDataOverviewBones from './../../../bones/arco-data-overview.bones.json'
import arcoTodayActivityBones from './../../../bones/arco-today-activity.bones.json'
import arcoContentThemeBones from './../../../bones/arco-content-theme.bones.json'
import arcoContentSourceBones from './../../../bones/arco-content-source.bones.json'

const { Row, Col } = Grid;
const { Title } = Typography;

function DataAnalysis() {
  const t = useLocale(locale);
  const [loading, setLoading] = useState(true);
  const [interval, setInterval] = useState([]);
  const [polarLoading, setPolarLoading] = useState(true);
  const [polar, setPolar] = useState({ list: [], fields: [] });
  const [multiPieLoading, setMultiPieLoading] = useState(true);
  const [multiPie, setMultiPie] = useState([]);

  const getInterval = async () => {
    setLoading(true);
    const { data } = await axios
      .get('/api/multi-dimension/activity')
      .finally(() => {
        setLoading(false);
      });
    setInterval(data);
  };

  const getPolar = async () => {
    setPolarLoading(true);
    const { data } = await axios
      .get('/api/multi-dimension/polar')
      .finally(() => setPolarLoading(false));

    setPolar(data);
  };

  const getMultiPie = async () => {
    setMultiPieLoading(true);
    const { data } = await axios
      .get('/api/multi-dimension/content-source')
      .finally(() => {
        setMultiPieLoading(false);
      });

    setMultiPie(data);
  };

  useEffect(() => {
    getInterval();
    getPolar();
    getMultiPie();
  }, []);

  return (
    <Space size={16} direction="vertical" style={{ width: '100%' }}>
      <Row gutter={20}>
        <Col span={16}>
          <Skeleton loading={loading} bones={arcoDataOverviewBones} animation="shimmer">
            <Card data-ske-name="arco-data-overview">
              <Title heading={6}>
                {t['multiDAnalysis.card.title.dataOverview']}
              </Title>
              <DataOverview />
            </Card>
          </Skeleton>
        </Col>
        <Col span={8}>
          <Skeleton loading={loading} bones={arcoTodayActivityBones} animation="shimmer">
            <Card data-ske-name="arco-today-activity">
              <Title heading={6}>
                {t['multiDAnalysis.card.title.todayActivity']}
              </Title>
              <HorizontalInterval
                data={interval}
                loading={loading}
                height={160}
              />
            </Card>
          </Skeleton>
          <Skeleton loading={polarLoading} bones={arcoContentThemeBones} animation="shimmer">
            <Card data-ske-name="arco-content-theme">
              <Title heading={6}>
                {t['multiDAnalysis.card.title.contentTheme']}
              </Title>
              <AreaPolar
                data={polar.list}
                fields={polar.fields}
                height={197}
                loading={polarLoading}
              />
            </Card>
          </Skeleton>
        </Col>
      </Row>
      <Row>
        <Col span={24}>
          <CardList />
        </Col>
      </Row>
      <Row>
        <Col span={24}>
          <Skeleton loading={multiPieLoading} bones={arcoContentSourceBones} animation="shimmer">
            <Card data-ske-name="arco-content-source">
              <Title heading={6}>
                {t['multiDAnalysis.card.title.contentSource']}
              </Title>
              <FactMultiPie
                loading={multiPieLoading}
                data={multiPie}
                height={240}
              />
            </Card>
          </Skeleton>
        </Col>
      </Row>
    </Space>
  );
}

export default DataAnalysis;
