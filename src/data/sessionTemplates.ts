import type { Session } from '@/types/session'

/** A pre-configured session template for common server types */
export interface SessionTemplate {
  name: string
  description: string
  /** Lucide icon name string */
  icon: string
  /** Partial Session fields used as defaults when creating from this template */
  defaults: Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>
}

export const sessionTemplates: SessionTemplate[] = [
  {
    name: 'Web Server',
    description: 'Nginx/Apache web server with uptime and disk checks',
    icon: 'Globe',
    defaults: {
      port: 22,
      startupCommands: [
        { command: 'uptime', delay: 0, waitForPrompt: true, enabled: true },
        { command: 'df -h', delay: 0, waitForPrompt: true, enabled: true },
        { command: 'nginx -v || apache2 -v', delay: 0, waitForPrompt: true, enabled: true }
      ]
    }
  },
  {
    name: 'Database Server',
    description: 'MySQL/PostgreSQL server with version and disk checks',
    icon: 'Database',
    defaults: {
      port: 22,
      startupCommands: [
        { command: 'mysql --version || psql --version', delay: 0, waitForPrompt: true, enabled: true },
        { command: 'df -h', delay: 0, waitForPrompt: true, enabled: true }
      ]
    }
  },
  {
    name: 'Docker Host',
    description: 'Docker server with container status overview',
    icon: 'Container',
    defaults: {
      port: 22,
      startupCommands: [
        { command: 'docker ps', delay: 0, waitForPrompt: true, enabled: true },
        { command: 'docker stats --no-stream', delay: 0, waitForPrompt: true, enabled: true }
      ]
    }
  },
  {
    name: 'AWS EC2',
    description: 'Amazon EC2 instance with public key authentication',
    icon: 'Cloud',
    defaults: {
      port: 22,
      username: 'ec2-user',
      auth: {
        initialMethod: 'publickey'
      }
    }
  },
  {
    name: 'Raspberry Pi',
    description: 'Raspberry Pi with default pi user',
    icon: 'Cpu',
    defaults: {
      port: 22,
      username: 'pi'
    }
  },
  {
    name: 'Generic Linux',
    description: 'Standard Linux server with root access',
    icon: 'Terminal',
    defaults: {
      port: 22,
      username: 'root'
    }
  }
]
