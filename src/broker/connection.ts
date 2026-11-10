import { connect } from 'amqp-connection-manager';
import { config } from '../core/config';

export const connection = connect([
  {
    protocol: 'amqp',
    hostname: config.RABBITMQ_HOST,
    port: config.RABBITMQ_PORT,
    username: config.RABBITMQ_USER,
    password: config.RABBITMQ_PASSWORD,
  },
]);
