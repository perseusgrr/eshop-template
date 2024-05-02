import 'dotenv/config';
import { error, success } from '@evershop/evershop/src/lib/log/logger.js';
import { pool } from '@evershop/evershop/src/lib/postgres/connection.js';
import { hashPassword } from '@evershop/evershop/src/lib/util/passwordHelper.js';
import { update, select } from '@evershop/postgres-query-builder';
import yargs from 'yargs';

function isValidPassword(password) {
  return password.length >= 8;
}

const { argv } = yargs
  .option('email', {
    alias: 'e',
    description: 'User email',
    demandOption: true,
    type: 'string',
    validate: (email) => {
      if (email.length === 0) {
        throw new Error('Email is required');
      }
      return true;
    }
  })
  .option('password', {
    alias: 'p',
    description: 'New password',
    demandOption: true,
    type: 'string'
  })
  .check((argv) => {
    if (!isValidPassword(argv.password)) {
      throw new Error(
        'Invalid password. Password must be at least 8 characters long'
      );
    }
    return true;
  })
  .help();

async function updatePassword() {
  const { email, password } = argv;

  try {
    const user = await select()
      .from('admin_user')
      .where('email', '=', email)
      .load(pool);

    if (!user) {
      throw new Error('User not found');
    }
    await update('admin_user')
      .given({
        password: hashPassword(password)
      })
      .where('admin_user_id', '=', user.admin_user_id)
      .execute(pool);
    success('Password is updated successfully');
    process.exit(0);
  } catch (e) {
    error(e);
    process.exit(0);
  }
}

updatePassword();
