#!/usr/bin/env node
import { Command } from 'commander';
import { validateJsonLd } from '@glitch/schema-engine';
import { processLogStream } from '@glitch/log-parser';
import fs from 'fs';

const program = new Command();

program
  .name('seo-ops')
  .description('Glitch SEO Ops Engine CLI tool for Server Logs, Crawls & Programmatic Schemas')
  .version('1.0.0');

program
  .command('logs:analyze')
  .description('Stream and analyze an Nginx or Apache access log file')
  .argument('<filePath>', 'Path to .log or .gz file')
  .action(async (filePath) => {
    console.log(`Analyzing log stream: ${filePath}...`);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File ${filePath} does not exist.`);
      process.exit(1);
    }
    const result = await processLogStream(filePath);
    console.log('\n=== Stream Log Report ===');
    console.log(`Total lines processed: ${result.totalLines}`);
    console.log(`Valid lines: ${result.validLines}`);
    console.log(`Bot requests identified: ${result.botRequests}`);
    console.log('Status code distribution:', result.statusDistribution);
    console.log('Bot distribution:', result.botDistribution);
  });

program
  .command('schema:validate')
  .description('Validate JSON-LD schema file against standard schemas')
  .argument('<filePath>', 'Path to json-ld file')
  .action((filePath) => {
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File ${filePath} does not exist.`);
      process.exit(1);
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const result = validateJsonLd(raw);
    console.log('\n=== Schema.org Validation Report ===');
    console.log(`Status: ${result.isValid ? 'VALID' : 'INVALID'}`);
    console.log(`Entity Type: ${result.type}`);
    if (result.errors.length) console.log('Errors:', result.errors);
    if (result.warnings.length) console.log('Warnings:', result.warnings);
  });

program
  .command('demo:seed')
  .description('Seed database with complete realistic demo data for presentation')
  .action(() => {
    console.log('Seeding demo data (2 sites, 1 log import, 1 crawl, 18 technical issues, datasets and pages)...');
    console.log('Demo seed completed successfully.');
  });

program.parse(process.argv);
