'use client';

import React, { useState } from 'react';
import {
  LayoutDashboard,
  Workflow,
  Network,
  Search,
  Sun,
  Moon,
  Bell,
  Settings,
  Download,
  Plus,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Bot,
  Activity,
  Layers,
  Sparkles,
  ChevronRight,
  ArrowUpRight,
  Check,
  MoreVertical,
  ExternalLink,
  ShieldCheck
} from 'lucide-react';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'workflows' | 'integrations'>('dashboard');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [selectedSite, setSelectedSite] = useState('Glitch Tech Media (glitchtech.io)');

  return (
    <div className="min-h-screen bg-[#EEF0F8] p-4 md:p-8 flex items-center justify-center">
      {/* Outer Rounded Container with subtle border & shadow matching mockup */}
      <div className="w-full max-w-[1400px] bg-[#F4F6FC] rounded-[36px] shadow-2xl p-4 md:p-8 relative overflow-hidden border border-white/60">
        
        {/* TOP NAVIGATION BAR */}
        <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
          {/* Tabs */}
          <div className="flex items-center gap-6">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-2 pb-1.5 font-semibold text-sm transition-all ${
                activeTab === 'dashboard'
                  ? 'text-[#1E2132] border-b-2 border-[#1E2132]'
                  : 'text-[#8E95A5] hover:text-[#1E2132]'
              }`}
            >
              <LayoutDashboard className="w-4 h-4 text-[#5E5CE6]" />
              Dashboard
            </button>
            <button
              onClick={() => setActiveTab('workflows')}
              className={`flex items-center gap-2 pb-1.5 font-semibold text-sm transition-all ${
                activeTab === 'workflows'
                  ? 'text-[#1E2132] border-b-2 border-[#1E2132]'
                  : 'text-[#8E95A5] hover:text-[#1E2132]'
              }`}
            >
              <Workflow className="w-4 h-4 text-[#8E95A5]" />
              Workflows
            </button>
            <button
              onClick={() => setActiveTab('integrations')}
              className={`flex items-center gap-2 pb-1.5 font-semibold text-sm transition-all ${
                activeTab === 'integrations'
                  ? 'text-[#1E2132] border-b-2 border-[#1E2132]'
                  : 'text-[#8E95A5] hover:text-[#1E2132]'
              }`}
            >
              <Network className="w-4 h-4 text-[#8E95A5]" />
              Integrations
            </button>
          </div>

          {/* Search bar */}
          <div className="relative flex-1 max-w-xs hidden md:block">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8E95A5]" />
            <input
              type="text"
              placeholder="Search or type command"
              className="w-full pl-10 pr-4 py-2 bg-white/80 rounded-full text-xs text-[#1E2132] border border-gray-200/60 focus:outline-none focus:ring-2 focus:ring-[#5E5CE6]/30 shadow-sm"
            />
          </div>

          {/* Actions & Theme toggle */}
          <div className="flex items-center gap-3">
            {/* Light / Dark capsule switch */}
            <div className="flex items-center bg-white rounded-full p-1 border border-gray-200/60 shadow-sm text-xs">
              <button
                onClick={() => setIsDarkMode(false)}
                className={`flex items-center gap-1 px-3 py-1 rounded-full transition-all ${
                  !isDarkMode ? 'bg-[#5E5CE6] text-white font-medium shadow' : 'text-[#8E95A5]'
                }`}
              >
                <Sun className="w-3.5 h-3.5" />
                Light
              </button>
              <button
                onClick={() => setIsDarkMode(true)}
                className={`flex items-center gap-1 px-3 py-1 rounded-full transition-all ${
                  isDarkMode ? 'bg-[#1E2132] text-white font-medium shadow' : 'text-[#8E95A5]'
                }`}
              >
                <Moon className="w-3.5 h-3.5" />
                Dark
              </button>
            </div>

            <button className="p-2 bg-white rounded-full text-[#8E95A5] hover:text-[#1E2132] shadow-sm border border-gray-200/60">
              <Bell className="w-4 h-4" />
            </button>
            <button className="p-2 bg-white rounded-full text-[#8E95A5] hover:text-[#1E2132] shadow-sm border border-gray-200/60">
              <Settings className="w-4 h-4" />
            </button>

            <button className="flex items-center gap-2 px-3.5 py-1.5 bg-white text-[#1E2132] text-xs font-semibold rounded-full border border-gray-200 shadow-sm hover:bg-gray-50">
              <Download className="w-3.5 h-3.5 text-[#5E5CE6]" />
              Export data <span className="text-[10px] bg-indigo-100 text-[#5E5CE6] px-1.5 py-0.5 rounded-full">.xls</span>
            </button>

            <button className="flex items-center gap-1.5 px-4 py-2 bg-[#1E2132] text-white text-xs font-semibold rounded-full shadow hover:bg-black transition-all">
              Add new site
            </button>
          </div>
        </header>

        {/* MAIN BODY: LEFT CURVED SIDEBAR + CONTENT GRID */}
        <div className="flex gap-6">
          
          {/* FLOATING CURVED PILL SIDEBAR (Exact image styling) */}
          <aside className="w-16 bg-[#5E5CE6] rounded-[28px] py-6 flex flex-col items-center justify-between text-white shadow-xl shrink-0">
            <div className="flex flex-col items-center gap-6">
              <div className="p-2.5 bg-white/20 rounded-2xl cursor-pointer">
                <LayoutDashboard className="w-5 h-5 text-white" />
              </div>
              <div className="p-2 hover:bg-white/10 rounded-xl cursor-pointer transition">
                <Activity className="w-5 h-5 text-white/80" />
              </div>
              <div className="p-2 hover:bg-white/10 rounded-xl cursor-pointer transition relative">
                <Bot className="w-5 h-5 text-white/80" />
                <span className="w-2 h-2 bg-emerald-400 rounded-full absolute top-1.5 right-1.5 ring-2 ring-[#5E5CE6]"></span>
              </div>
              <div className="p-2 hover:bg-white/10 rounded-xl cursor-pointer transition">
                <Bell className="w-5 h-5 text-white/80" />
              </div>
              <div className="p-2 hover:bg-white/10 rounded-xl cursor-pointer transition">
                <Calendar className="w-5 h-5 text-white/80" />
              </div>
              <div className="p-2 hover:bg-white/10 rounded-xl cursor-pointer transition">
                <Layers className="w-5 h-5 text-white/80" />
              </div>
              <div className="p-2 hover:bg-white/10 rounded-xl cursor-pointer transition">
                <FileText className="w-5 h-5 text-white/80" />
              </div>
            </div>
            <div>
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center font-bold text-xs">
                G
              </div>
            </div>
          </aside>

          {/* DASHBOARD GRID CONTENT */}
          <div className="flex-1 space-y-6">
            
            {/* HERO GREETING & 3 SUMMARY ACTION CARDS */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              
              {/* Greeting text card */}
              <div className="lg:col-span-5 flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-2">
                  <h1 className="text-3xl font-bold tracking-tight text-[#1E2132]">
                    Hi, James!
                  </h1>
                  <span className="flex items-center -space-x-1">
                    <span className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[10px] font-bold border-2 border-white">
                      SEO
                    </span>
                    <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px] font-bold border-2 border-white">
                      AI
                    </span>
                  </span>
                </div>
                <h2 className="text-2xl font-semibold text-[#1E2132] mb-3">
                  What are your plans for today?
                </h2>
                <p className="text-sm text-[#8E95A5] leading-relaxed max-w-md">
                  This platform is designed to revolutionize the way you analyze server logs, audit technical crawls, and automate programmatic schema.
                </p>
              </div>

              {/* Action feature card 1: Log Stream Intelligence */}
              <div className="lg:col-span-2 bg-white rounded-[24px] p-5 shadow-soft border border-white flex flex-col justify-between hover:shadow-md transition">
                <div className="w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center text-[#5E5CE6] mb-3">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#1E2132]">Stream server logs</h3>
                  <p className="text-xs text-[#8E95A5] mt-1">Chunked memory-safe parsing of .log & .gz</p>
                </div>
              </div>

              {/* Action feature card 2: Technical SEO Crawl */}
              <div className="lg:col-span-2 bg-white rounded-[24px] p-5 shadow-soft border border-white flex flex-col justify-between hover:shadow-md transition">
                <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-500 mb-3">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#1E2132]">Audit & issues</h3>
                  <p className="text-xs text-[#8E95A5] mt-1">Detect 15+ crawl, index & metadata errors</p>
                </div>
              </div>

              {/* Action feature card 3: WordPress Drafts */}
              <div className="lg:col-span-3 bg-white rounded-[24px] p-5 shadow-soft border border-white flex flex-col justify-between hover:shadow-md transition">
                <div className="w-10 h-10 rounded-2xl bg-purple-50 flex items-center justify-center text-purple-600 mb-3">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#1E2132]">Publish drafts</h3>
                  <p className="text-xs text-[#8E95A5] mt-1">Safe draft publishing via WordPress REST API</p>
                </div>
              </div>

            </div>

            {/* THREE-COLUMN ROW (Notifications, Assignments/Issues, May Calendar/Schedule) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Column 1: Notifications / Critical SEO Alerts */}
              <div className="lg:col-span-4 bg-white rounded-[28px] p-6 shadow-soft border border-white">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-[#1E2132]">Notifications</h3>
                  <button className="text-xs text-[#8E95A5] hover:text-[#1E2132] flex items-center gap-1">
                    Clear
                  </button>
                </div>

                {/* Floating Notification Item 1 */}
                <div className="bg-[#FAFBFD] border border-gray-100 rounded-2xl p-4 shadow-sm mb-3 relative">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#1E2132] flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      Googlebot Spike Detected
                    </span>
                    <MoreVertical className="w-3.5 h-3.5 text-[#8E95A5]" />
                  </div>
                  <p className="text-xs text-[#8E95A5] mt-1">
                    Landing design meeting | Time: 120 min
                  </p>
                  <div className="flex items-center gap-3 text-[11px] text-[#8E95A5] mt-3">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Sat, 10 May
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> 11 AM - 11:45 AM
                    </span>
                  </div>
                </div>

                {/* Notification Item 2 */}
                <div className="p-3 bg-gray-50/70 rounded-2xl">
                  <div className="flex items-center justify-between text-xs font-semibold text-[#1E2132]">
                    <span>Crawl waste: 42 URLs returning 404</span>
                    <span className="text-[10px] text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full font-medium">Warning</span>
                  </div>
                  <p className="text-xs text-[#8E95A5] mt-1">
                    Bots are requesting broken faceted query params.
                  </p>
                </div>
              </div>

              {/* Column 2: Assignments / High Priority Technical Issues */}
              <div className="lg:col-span-4 bg-white rounded-[28px] p-6 shadow-soft border border-white flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-[#1E2132]">Assignments</h3>
                    <button className="text-xs text-[#8E95A5] hover:text-[#1E2132]">Edit</button>
                  </div>

                  <div className="flex items-center gap-2 text-xs font-semibold text-[#8E95A5] mb-2">
                    <span className="text-[#5E5CE6]">Motion design</span>
                    <span>Logo</span>
                  </div>

                  <h4 className="font-bold text-sm text-[#1E2132] mb-3">
                    Design a packaging concept for a new product
                  </h4>

                  <div className="flex items-center justify-between mb-4">
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">
                      Package design
                    </span>
                    <span className="px-3 py-1 bg-rose-100 text-rose-600 text-xs font-medium rounded-full">
                      High
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-[#8E95A5]">
                    <span>Assignee</span>
                    <span className="font-semibold text-[#1E2132]">Rachel Lee</span>
                  </div>
                </div>

                <button className="w-full mt-4 py-2.5 bg-[#FAFBFD] hover:bg-gray-100 border border-dashed border-gray-300 rounded-2xl text-xs font-semibold text-[#1E2132] flex items-center justify-center gap-2 transition">
                  <Plus className="w-4 h-4 text-[#5E5CE6]" />
                  Add new assignment
                </button>
              </div>

              {/* Column 3: Calendar & Schedule */}
              <div className="lg:col-span-4 bg-white rounded-[28px] p-6 shadow-soft border border-white">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-[#1E2132]">May 2021</h3>
                  <div className="flex items-center gap-1 text-xs text-[#8E95A5]">
                    <button className="p-1 hover:bg-gray-100 rounded-full">&lt;</button>
                    <button className="p-1 hover:bg-gray-100 rounded-full">&gt;</button>
                  </div>
                </div>

                {/* Days row */}
                <div className="grid grid-cols-7 text-center text-xs text-[#8E95A5] mb-4">
                  <div>Mon<div className="font-semibold text-[#1E2132] mt-1">14</div></div>
                  <div>Tue<div className="font-semibold text-[#1E2132] mt-1">15</div></div>
                  <div>Wed<div className="font-semibold text-[#1E2132] mt-1">16</div></div>
                  <div>Thr<div className="font-semibold text-[#1E2132] mt-1">17</div></div>
                  <div className="bg-[#5E5CE6] text-white rounded-xl py-1">Fri<div className="font-bold mt-1">18</div></div>
                  <div>Sat<div className="font-semibold text-[#1E2132] mt-1">19</div></div>
                  <div>Sun<div className="font-semibold text-[#1E2132] mt-1">20</div></div>
                </div>

                {/* Timeline items */}
                <div className="space-y-3 pt-2 border-t border-gray-100">
                  <div className="flex items-start gap-3 text-xs">
                    <span className="text-[#8E95A5] w-24">12:00-12:30 PM</span>
                    <div className="flex-1">
                      <div className="font-semibold text-[#1E2132]">Team meeting</div>
                      <div className="text-[11px] text-[#8E95A5]">UX / UI design</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 text-xs">
                    <span className="text-[#8E95A5] w-24">12:30-01:30 PM</span>
                    <div className="flex-1">
                      <div className="font-semibold text-[#1E2132]">Meeting with new client</div>
                      <div className="text-[11px] text-[#8E95A5]">Job interview</div>
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* LOWER ROW: TODAY TASKS, PROMO CARD & RADIAL METRICS */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Today Tasks table */}
              <div className="lg:col-span-5 bg-white rounded-[28px] p-6 shadow-soft border border-white">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-[#1E2132]">Today tasks</h3>
                    <div className="flex -space-x-1.5">
                      <span className="w-5 h-5 rounded-full bg-indigo-400 text-white text-[9px] flex items-center justify-center font-bold">J</span>
                      <span className="w-5 h-5 rounded-full bg-rose-400 text-white text-[9px] flex items-center justify-center font-bold">R</span>
                      <span className="w-5 h-5 rounded-full bg-emerald-400 text-white text-[9px] flex items-center justify-center font-bold">+</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[#8E95A5]">
                    <button className="hover:text-[#1E2132]">Edit</button>
                    <button className="hover:text-[#1E2132]">Share</button>
                  </div>
                </div>

                {/* Task 1 */}
                <div className="py-3 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-xs text-[#1E2132]">Conduct research</div>
                    <div className="text-[11px] text-[#8E95A5]">4 May, 09:20 AM • Duration 02 h 45 m</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-[#5E5CE6]">90%</span>
                    <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#5E5CE6] rounded-full w-[90%]"></div>
                    </div>
                  </div>
                </div>

                {/* Task 2 */}
                <div className="py-3 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-xs text-[#1E2132]">Schedule a meeting</div>
                    <div className="text-[11px] text-[#8E95A5]">14 May, 12:45 AM • Duration 06 h 55 m</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-[#5E5CE6]">50%</span>
                    <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#5E5CE6] rounded-full w-[50%]"></div>
                    </div>
                  </div>
                </div>

                {/* Task 3 */}
                <div className="py-3 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-xs text-[#1E2132]">Send out reminders</div>
                    <div className="text-[11px] text-[#8E95A5]">21 May, 10:30 AM • Duration 01 h 30 m</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-[#5E5CE6]">10%</span>
                    <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#5E5CE6] rounded-full w-[10%]"></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Promo Card: "Go premium!" style matching mockup */}
              <div className="lg:col-span-3 bg-[#5E5CE6] text-white rounded-[28px] p-6 shadow-float flex flex-col justify-between items-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center my-2">
                  <Sparkles className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Glitch SEO Pro</h3>
                  <p className="text-xs text-white/80 mt-1">
                    Continuous streaming log listener & automated GSC syncer
                  </p>
                </div>
                <button className="w-full py-2.5 bg-black/40 hover:bg-black/60 rounded-full text-xs font-semibold text-white mt-4 transition">
                  Find out more
                </button>
              </div>

              {/* Radial Metrics Cards & Board Meeting Card */}
              <div className="lg:col-span-4 flex flex-col justify-between gap-4">
                
                {/* 2 circular progress cards */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white rounded-[24px] p-4 shadow-soft border border-white flex flex-col items-center text-center">
                    <div className="w-14 h-14 rounded-full border-4 border-emerald-400 flex items-center justify-center font-bold text-sm text-[#1E2132] mb-2">
                      90%
                    </div>
                    <div className="text-[11px] font-semibold text-emerald-600">DATA RESEARCH</div>
                    <div className="text-xs font-bold text-[#1E2132]">Marketing</div>
                    <div className="text-[10px] text-[#8E95A5] mt-1">All assignments done!</div>
                  </div>

                  <div className="bg-white rounded-[24px] p-4 shadow-soft border border-white flex flex-col items-center text-center">
                    <div className="w-14 h-14 rounded-full border-4 border-[#FF7597] flex items-center justify-center font-bold text-sm text-[#1E2132] mb-2">
                      65%
                    </div>
                    <div className="text-[11px] font-semibold text-[#FF7597]">UX/UI DESIGN</div>
                    <div className="text-xs font-bold text-[#1E2132]">Typography</div>
                    <button className="mt-2 px-3 py-1 bg-indigo-600 text-white rounded-full text-[10px] font-semibold">
                      Check
                    </button>
                  </div>
                </div>

                {/* Board Meeting Card */}
                <div className="bg-white rounded-[24px] p-4 shadow-soft border border-white">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-bold text-xs text-[#1E2132]">Board meeting</h4>
                    <button className="text-[10px] text-[#8E95A5] hover:text-[#1E2132]">Edit</button>
                  </div>
                  <p className="text-[11px] text-[#8E95A5] mb-3">
                    Meeting with John Smith, 4th floor, room 159
                  </p>
                  <div className="flex items-center gap-2">
                    <button className="flex-1 py-1.5 bg-gray-100 hover:bg-gray-200 text-[#1E2132] text-xs font-semibold rounded-xl">
                      Reschedule
                    </button>
                    <button className="flex-1 py-1.5 bg-[#5E5CE6] hover:bg-indigo-600 text-white text-xs font-semibold rounded-xl">
                      Accept invite
                    </button>
                  </div>
                </div>

              </div>

            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
