// Author: Sherif Sarhan
// Date: 10/9/2017
// This loads the environment variables from the .env file
require('dotenv-extended').load();

var builder = require('botbuilder');
var restify = require('restify');
var Store = require('./store');
var spellService = require('./spell-service');
var FuzzySet = require('fuzzyset.js');

// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
    console.log('%s listening to %s', server.name, server.url);
});
// Create connector and listen for messages
var connector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});
server.post('/api/messages', connector.listen());

var bot = new builder.UniversalBot(connector, function (session) {
    session.send('Sorry, I did not understand \'%s\'. Type \'help\' if you need assistance.', session.message.text);
});

// You can provide your own model by specifing the 'LUIS_MODEL_URL' environment variable
// This Url can be obtained by uploading or creating your model from the LUIS portal: https://www.luis.ai/
var recognizer = new builder.LuisRecognizer(process.env.LUIS_MODEL_URL);
bot.recognizer(recognizer);

var doctorEntity;
var timeEntity;
var reasonEntity;
const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
const dateOptionsShort = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
const dateOptionsShortWithTime = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
const timeOptionsShort = { hour: '2-digit', minute: '2-digit' };
var doctorsSchedule = {
    Radiologist: {
        2017: {
            9: {
                23: {
                    9: {
                        0: 'booked',
                        30: 'available'
                    },
                    10: {
                        0: 'available',
                        30: 'available'
                    },
                    14: {
                        0: 'booked',
                        30: 'available'
                    },
                    15: {
                        0: 'available'
                    }
                },
                24: {
                    8: {
                        0: 'booked',
                        30: 'available'
                    },
                    11: {
                        0: 'available'
                    },
                    13: {
                        0: 'booked',
                        30: 'available'
                    },
                    15: {
                        0: 'available'
                    }
                }
            }
        }
    }
}

function cleanDateRange(dateRange) {
    let dateRangeClean = []
    // check if there is more than one date RANGE
    // make sure the ranges are clean. Ex. cannot be a range in the past
    if (dateRange.length > 1) {
        // there is
        // if the start of the range is not before today, add it to array
        dateRange.forEach((date) => {
            let tempDateObj = new Date(date.start);
            let tempDate = tempDateObj.getUTCDate();
            let tempMonth = tempDateObj.getMonth();

            let currDateObj = new Date();
            let currDate = currDateObj.getUTCDate();
            let currMonth = currDateObj.getMonth();
            // if the date is today or onwards
            if ((tempMonth > currMonth) || (tempMonth = currMonth && tempDate >= currDate)) {
                // add it to acceptable date range
                dateRangeClean.push(date);
            }
        });
    }
    if (dateRange.length == 1) dateRangeClean.push(dateRange[0]);
    return dateRangeClean;
}

function handleDateTimeRange(session, dateRangeClean) {
    // may have 0 date ranges after cleaning
    // ask time and tell them the date can't be in the past
    if (!dateRangeClean.length) {
        // then open dialog asking for day/time
        session.beginDialog('askDayAndTime', { pastDate: true });
    }

    // may have 1 date range after cleaning 
    if (dateRangeClean.length == 1) {
        // check for available timeslots that fall in between start/end in given day
        session.userData.requestedDate = new Date(dateRangeClean[0].start);
        session.userData.availableTimeslots = getAvailableTimeslots(session, new Date(dateRangeClean[0].end));

        // if no available timeslots
        // try to find another day/time that works
        let isTimeslotAvailable = session.userData.availableTimeslots.length > 0;
        if (isTimeslotAvailable) {
            session.beginDialog('askTimeForGivenDay', { avail: isTimeslotAvailable });
        }
        else {
            session.beginDialog('askTimeForGivenDay', { unavail: !isTimeslotAvailable });
        }
    }
    // TODO: may have >1 date ranges after cleaning
}

Date.prototype.addDays = function (days) {
    var date = new Date(this.valueOf());
    date.setDate(date.getDate() + days);
    return date;
}

function getDates(startDate, stopDate) {
    // returns array of dates in between two dates
    var dateArray = new Array();
    var currentDate = startDate;
    while (currentDate <= stopDate) {
        dateArray.push(new Date(currentDate));
        currentDate = currentDate.addDays(1);
    }
    return dateArray;
}

function handleDateRange(session, dateRangeClean) {
    // get array of dates we need timeslots for
    let dates = getDates(new Date(dateRangeClean[0].start), new Date(dateRangeClean[0].end));

    let allTimeslots = []
    // for each date, get available timeslots and add it to total timeslots list
    dates.forEach((date) => {
        session.userData.requestedDate = date;
        let timeslots = getAvailableTimeslots(session);
        allTimeslots = allTimeslots.concat(timeslots);
    });
    session.userData.availableTimeslots = allTimeslots;
    session.beginDialog('askTimeForGivenDay', { avail: true, dateRange: true });
}

bot.dialog('scheduleAppointment', [
    function (session, args, next) {
        session.userData = {};
        // session.send('Welcome to the Appointment Scheduler! We are analyzing your message: \'%s\'', session.message.text);
        // try extracting entities
        session.userData.doctorEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'DoctorType');

        session.userData.dateEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'builtin.datetimeV2.date');
        session.userData.timeEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'builtin.datetimeV2.time');
        session.userData.dateTimeEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'builtin.datetimeV2.datetime');
        session.userData.dateTimeRangeEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'builtin.datetimeV2.datetimerange');
        session.userData.timeRangeEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'builtin.datetimeV2.timerange');
        session.userData.dateRangeEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'builtin.datetimeV2.daterange');

        session.userData.reasonEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'AppointmentReason');

        if (!session.userData.doctorEntity) {
            // doctor type entity is not detected, ask for it
            session.beginDialog('askDoctorType');
        }
        else {
            // doctor type entity is detected, isolate doctor type through approximate matching
            a = FuzzySet(['Radiologist', 'Psychologist', 'Cardiologist', 'Dermatologist']);
            // check if doctor user entered is in available set
            if (!a.get(session.userData.doctorEntity.entity) || a.get(session.userData.doctorEntity.entity)[0][0] < .5) {
                // not in available set. ask for doctor type
                session.beginDialog('askDoctorType');
            }
            session.userData.doctorType = a.get(session.userData.doctorEntity.entity)[0][1];
            next();
        }
    },
    function (session, args, next) {
        // if there is no date nor time ex. tomorrow 2pm
        // nor datetimerange
        if (!session.userData.dateEntity && !session.userData.timeEntity &&
            !session.userData.dateTimeEntity && !session.userData.dateTimeRangeEntity &&
            !session.userData.timeRangeEntity && !session.userData.dateRangeEntity) {
            // then open dialog asking for day/time
            session.beginDialog('askDayAndTime');
        }

        // if there's no time ex. 2pm
        // then display available times for that day
        if (session.userData.dateEntity) {
            // then open dialog asking for time
            let reqDate = builder.EntityRecognizer.parseTime(session.userData.dateEntity.entity);
            session.userData.requestedDate = reqDate;
            session.beginDialog('askTimeForGivenDay');
        }

        // if there's no day ex. tomorrow
        // open dialog asking what days for that time
        if (session.userData.timeEntity) {
            // then open dialog asking for day
            let reqDate = builder.EntityRecognizer.parseTime(session.userData.timeEntity.entity);
            session.userData.requestedDate = reqDate;
            // check if time is proper
            if (!isIncrementOfThirty(reqDate)) {
                session.userData.postProper = 'askDayForGivenTime';
                session.beginDialog('askProperTime');
            }
            else {
                // ask for dayForTime
                session.beginDialog('askDayForGivenTime');
            }
        }

        // if there are both date & time
        // then use datetime entity and check if available
        if (session.userData.dateTimeEntity) {
            // check if is/isn't available
            let reqDate = builder.EntityRecognizer.parseTime(session.userData.dateTimeEntity.entity);
            session.userData.requestedDate = reqDate;

            // check if time is not proper
            if (!isIncrementOfThirty(reqDate)) {
                session.userData.postProper = 'askTimeForGivenDay';
                session.userData.checkAvailable = true;
                session.beginDialog('askProperTime');
            }
            else {
                // check if date is/isn't available in doctor's calendar
                if (!isTimeslotAvailable(session, reqDate)) {
                    // if not, try to find another time/day that works
                    // since the requested time/date is not available
                    session.beginDialog('askTimeForGivenDay', { unavail: true });
                }
                else {
                    next();
                }
            }
        }

        // if there is a date and time range
        // then use datetimerange entity and check if available
        if (session.userData.dateTimeRangeEntity) {
            let dateRange = session.userData.dateTimeRangeEntity.resolution.values;
            let dateRangeClean = cleanDateRange(dateRange);
            handleDateTimeRange(session, dateRangeClean);
        }

        // if there is a time range detected
        if (session.userData.timeRangeEntity) {
            let timeRangeStart = session.userData.timeRangeEntity.resolution.values[0].start;
            let timeRangeEnd = session.userData.timeRangeEntity.resolution.values[0].end;
            session.beginDialog('askDayForGivenTime', { timeRange: { start: timeRangeStart, end: timeRangeEnd } });
        }

        // if there is a date range detected
        if (session.userData.dateRangeEntity) {
            // get date ranges not in the past
            let dateRange = session.userData.dateRangeEntity.resolution.values;
            let dateRangeClean = cleanDateRange(dateRange);

            // now have a clean date range
            // find all available timeslots in that daterange
            handleDateRange(session, dateRangeClean);

        }
    },
    function (session, args, next) {
        if (!session.userData.reasonEntity) {
            // reason entity is not detected, continue to next step
            session.beginDialog('askReason');
        }
        else {
            session.userData.apptReason = session.userData.reasonEntity;
            next();
        }
    },
    function (session) {
        session.send('Alright! Your appointment is scheduled with a ' + session.userData.doctorType +
            ' for ' + new Date(session.userData.requestedDate).toLocaleDateString('en-US', dateOptions));
        session.send("Thanks!");
    }
]).triggerAction({
    matches: 'ScheduleAppointment',
    intentThreshold: .65
});

bot.dialog('askDoctorType', [
    function (session, args) {
        builder.Prompts.choice(session, 'What type of doctor you would like to see?',
            ['Radiologist', 'Psychiatrist', 'Cardiologist', 'Dermatologist'],
            { listStyle: builder.ListStyle.button });
    },
    function (session, args) {
        const doctorType = args.response.entity;
        if (!doctorType) session.replaceDialog('askDoctorType', { reprompt: true });
        else {
            session.userData.doctorType = doctorType;
            session.endDialog();
        }
    }
]);

bot.dialog('askDayAndTime', [
    function (session, args) {
        if (args && args.pastDate) {
            session.send("The date cannot be in the past");
        }
        builder.Prompts.text(session, 'Please enter a day, a time, both, or a date and time range');
    },
    function (session, args) {
        // recognize entity check if received date, time, both or neither
        builder.LuisRecognizer.recognize(args.response, process.env.LUIS_MODEL_URL,
            function (err, intents, entities) {
                if (entities) {
                    // only one of these will be not null
                    let dateTimeEntity = builder.EntityRecognizer.findEntity(entities, 'builtin.datetimeV2.datetime');
                    let dateEntity = builder.EntityRecognizer.findEntity(entities, 'builtin.datetimeV2.date');
                    let timeEntity = builder.EntityRecognizer.findEntity(entities, 'builtin.datetimeV2.time');
                    let dateTimeRangeEntity = builder.EntityRecognizer.findEntity(entities, 'builtin.datetimeV2.datetimerange');
                    let timeRangeEntity = builder.EntityRecognizer.findEntity(entities, 'builtin.datetimeV2.timerange');
                    let dateRangeEntity = builder.EntityRecognizer.findEntity(entities, 'builtin.datetimeV2.daterange');


                    if (!dateTimeEntity && !dateEntity && !timeEntity && !dateTimeRangeEntity && !timeRangeEntity && !dateRangeEntity) {
                        session.replaceDialog('askDayAndTime', { reprompt: true });
                    }

                    // do something with entity...


                    if (dateTimeEntity) {
                        // returns date object
                        let reqDate = new Date(dateTimeEntity.resolution.values[0].value);
                        session.userData.requestedDate = reqDate;
                        // check if time is not proper
                        if (!isIncrementOfThirty(reqDate)) {
                            session.userData.postProper = 'askTimeForGivenDay';
                            session.replaceDialog('askProperTime');
                        }
                        else {
                            // check if date is/isn't available in doctor's calendar
                            if (!isTimeslotAvailable(session, reqDate)) {
                                // if not, try to find another time/day that works
                                // since the requested time/date is not available
                                session.replaceDialog('askTimeForGivenDay', { unavail: true });
                            }
                            else {
                                session.endDialog();
                            }
                        }
                    }
                    if (dateEntity) {
                        // returns date object
                        let reqDate = new Date(dateEntity.resolution.values[0].value);
                        session.userData.requestedDate = reqDate;
                        // ask for timeForDay
                        session.replaceDialog('askTimeForGivenDay');
                    }
                    if (timeEntity) {
                        // returns date object
                        let reqDate = builder.EntityRecognizer.parseTime(timeEntity.entity);
                        session.userData.requestedDate = reqDate;
                        // check if time is proper
                        if (!isIncrementOfThirty(reqDate)) {
                            session.userData.postProper = 'askDayForGivenTime';
                            session.replaceDialog('askProperTime');
                        }
                        else {
                            // ask for dayForTime
                            session.replaceDialog('askDayForGivenTime');
                        }
                    }

                    if (dateTimeRangeEntity) {
                        let dateRange = dateTimeRangeEntity.resolution.values;
                        let dateRangeClean = cleanDateRange(dateRange);
                        handleDateTimeRange(session, dateRangeClean);
                    }

                    // if there is a time range detected
                    if (timeRangeEntity) {
                        let timeRangeStart = timeRangeEntity.resolution.values[0].start;
                        let timeRangeEnd = timeRangeEntity.resolution.values[0].end;
                        session.beginDialog('askDayForGivenTime', { timeRange: { start: timeRangeStart, end: timeRangeEnd } });
                    }

                    // if there is a date range detected
                    if (dateRangeEntity) {
                        // get date ranges not in the past
                        let dateRange = dateRangeEntity.resolution.values;
                        let dateRangeClean = cleanDateRange(dateRange);

                        // now have a clean date range
                        // find all available timeslots in that daterange
                        handleDateRange(session, dateRangeClean);
                    }

                }
            });
    }
]);

bot.dialog('askProperTime', [
    function (session, args) {
        builder.Prompts.time(session, 'Please provide increments of 30 minutes only. (Examples: 1:30PM, 2:00PM, 2:30PM');
    },
    function (session, args) {
        const time = args.response.entity;
        if (!time) session.replaceDialog('askProperTime', { reprompt: true });

        // recognize entity check if actually received time
        builder.LuisRecognizer.recognize(time, process.env.LUIS_MODEL_URL,
            function (err, intents, entities) {
                if (entities) {
                    let timeEntity = builder.EntityRecognizer.findEntity(entities, 'builtin.datetimeV2.time');
                    // do something with entity...

                    // returns date object
                    let reqDate = builder.EntityRecognizer.parseTime(time);
                    if (!timeEntity || !isIncrementOfThirty(reqDate)) {
                        session.replaceDialog('askProperTime');
                    }
                    else {
                        session.userData.requestedDate = new Date(session.userData.requestedDate);
                        session.userData.requestedDate.setTime(reqDate.getTime());
                        if (session.userData.checkAvailable) {
                            if (isTimeslotAvailable(session, reqDate)) session.endDialog();
                            else {
                                session.replaceDialog(session.userData.postProper, { unavail: true });
                            }
                        }
                        else {
                            session.replaceDialog(session.userData.postProper);
                        }
                    }
                }
            });
    }
])

bot.dialog('askTimeForGivenDay', [
    function (session, args) {
        session.userData.availableTimeslots = (args && args.avail) ? session.userData.availableTimeslots : getAvailableTimeslots(session);
        let timeslotStrings = [];
        if (args && args.dateRange) {
            session.userData.availableTimeslots.forEach((timeslot) => timeslotStrings.push(timeslot.toLocaleTimeString('en-US', dateOptionsShortWithTime)));
        }
        else {
            session.userData.availableTimeslots.forEach((timeslot) => timeslotStrings.push(timeslot.toLocaleTimeString('en-US', timeOptionsShort)));
        }
        timeslotStrings.push('Pick a different time/day');

        if (timeslotStrings.length == 1) {
            session.send('Sorry, this day has no available timeslots. Please pick a different date/time.');
            session.replaceDialog('askDayAndTime');
        }
        else {
            if (args) {
                if (args.reprompt) session.send('Please choose from the available options');
                if (args.unavail) {
                    session.send('Sorry, that timeslot is booked. However, here are some other times for this day.');
                    timeslotStrings.push(`View days with ${session.userData.requestedDate.toLocaleTimeString('en-US', timeOptionsShort)} available`);
                }
            }
            builder.Prompts.choice(session, 'Which one of these times would you prefer?',
                timeslotStrings,
                { listStyle: builder.ListStyle.button });
        }
    },
    function (session, args) {
        if (!args.response.entity) replaceDialog('askTimeForGivenDay', { reprompt: true })
        if (args.response.entity == 'Pick a different time/day') {
            session.replaceDialog('askDayAndTime');
        }
        else if (args.response.entity == `View days with ${new Date(session.userData.requestedDate).toLocaleTimeString('en-US', timeOptionsShort)} available`) {
            session.replaceDialog('askDayForGivenTime');
        }
        else {
            // mark it as booked
            let exactTime = new Date(session.userData.availableTimeslots[args.response.index]);
            session.userData.requestedDate = exactTime;

            session.endDialog();
        }
    }
]);

bot.dialog('askDayForGivenTime', [
    function (session, args) {
        let dayStrings = [];
        let timeslotString;
        if (args && args.timeRange) {
            // get array of dates that are in between time range
            session.userData.availableDays = getAvailableDays(session, args.timeRange);
            session.userData.availableDays.forEach((day) => dayStrings.push(day.toLocaleDateString('en-US', dateOptionsShortWithTime)));
            timeslotString = `${builder.EntityRecognizer.parseTime(args.timeRange.start).toLocaleTimeString('en-US', timeOptionsShort)} - 
            ${builder.EntityRecognizer.parseTime(args.timeRange.end).toLocaleTimeString('en-US', timeOptionsShort)}`;
        }
        else {
            // get array of dates which have hour & minute available
            session.userData.availableDays = getAvailableDays(session);
            session.userData.availableDays.forEach((day) => dayStrings.push(day.toLocaleDateString('en-US', dateOptionsShort)));
            timeslotString = session.userData.requestedDate.toLocaleTimeString('en-US', timeOptionsShort);
        }

        dayStrings.push('Pick a different time or day');
        if (dayStrings.length == 1) {
            // no available days for that time
            // ask for different time
            session.send('Sorry, there are no available days with this time. Please pick a different date/time.');
            session.replaceDialog('askDayAndTime');
        }
        else {
            builder.Prompts.choice(session, `Here are the days with a ${timeslotString} timeslot available`, dayStrings,
                { listStyle: builder.ListStyle.button });
        }
    },
    function (session, args) {
        if (!args.response.entity) replaceDialog('askDayForGivenTime', { reprompt: true })
        else if (args.response.entity == 'Pick a different time or day') {
            session.replaceDialog('askDayAndTime');
        }
        else {
            let storedDate = new Date(session.userData.requestedDate);
            storedDate.setDate(new Date(session.userData.availableDays[args.response.index]).getUTCDate());
            session.userData.requestedDate = storedDate;
            session.endDialog();
        }
    }
]);

function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60000);
}

function isTimeslotAvailable(session, requestedDate) {
    let apptDatePath = doctorsSchedule[session.userData.doctorType][requestedDate.getFullYear()][requestedDate.getMonth()]
    [requestedDate.getUTCDate()][requestedDate.getHours()];
    if (apptDatePath && apptDatePath[requestedDate.getMinutes()] == 'available') {
        return true;
    }
    return false;
}

function bookTimelot(session, requestedDate) {
    let apptDatePath = doctorsSchedule[session.userData.doctorType][requestedDate.getFullYear()][requestedDate.getMonth()]
    [requestedDate.getUTCDate()][requestedDate.getHours()];
    if (apptDatePath[requestedDate.getMinutes()] == 'available') {
        apptDatePath[requestedDate.getMinutes()] = 'booked';
        return true;
    }
    return false;
}

function getAvailableTimeslots(session, endTime) {
    let requestedDate = (session.userData.requestedDate instanceof Date) ? session.userData.requestedDate : new Date(session.userData.requestedDate);
    let apptHours = doctorsSchedule[session.userData.doctorType][requestedDate.getFullYear()][requestedDate.getMonth()]
    [requestedDate.getUTCDate()];
    let availableTimes = [];
    for (var hour in apptHours) {
        if (apptHours.hasOwnProperty(hour)) {
            var minutes = apptHours[hour];
            for (var minute in minutes) {
                if (apptHours[hour][minute] == 'available') {
                    // looks messy but is simple
                    // 2 conditions for the timeslot to be added even though the timeslot is available
                    // 1: need to check the range and see if it fits in between
                    // 2: do not need to check the range, so just add it
                    if (endTime) {
                        endTime = new Date(endTime);
                        let afterReqStart = (hour > requestedDate.getHours() || (hour == requestedDate.getHours() && minute >= requestedDate.getMinutes()));
                        let beforeReqEnd = (hour < endTime.getHours() || (hour == endTime.getHours() && minute < endTime.getMinutes()));
                        let inRange = isInTimeRange(requestedDate, endTime, { hour, minute });
                        if (inRange) {
                            let timeslot = new Date(requestedDate.getFullYear(), requestedDate.getMonth(), requestedDate.getUTCDate(), hour, minute);
                            availableTimes.push(timeslot);
                        }
                    }
                    else {
                        let timeslot = new Date(requestedDate.getFullYear(), requestedDate.getMonth(), requestedDate.getUTCDate(), hour, minute);
                        availableTimes.push(timeslot);
                    }
                }
            }
        }
    }
    return availableTimes;
}

function isInTimeRange(start, end, time) {
    start = (start instanceof Date) ? start : builder.EntityRecognizer.parseTime(start);
    end = (end instanceof Date) ? end : builder.EntityRecognizer.parseTime(end);

    let afterReqStart = (time.hour > start.getHours() || (time.hour == start.getHours() && time.minute >= start.getMinutes()));
    let beforeReqEnd = (time.hour < end.getHours() || (time.hour == end.getHours() && time.minute < end.getMinutes()));
    return (afterReqStart && beforeReqEnd);
}

function getAvailableDays(session, timeRange) {
    if (timeRange) session.userData.requestedDate = builder.EntityRecognizer.parseTime(timeRange.start);
    let requestedDate = (session.userData.requestedDate instanceof Date) ? session.userData.requestedDate : new Date(session.userData.requestedDate);
    let sched = doctorsSchedule[session.userData.doctorType];
    let availableDays = [];
    for (let year in sched) {
        for (let month in sched[year]) {
            for (var day in sched[year][month]) {
                let schedDay = sched[year][month][day];

                // if supplied a timeRange
                if (timeRange) {
                    for (var hour in schedDay) {
                        for (var minute in schedDay[hour]) {
                            if (schedDay[hour][minute] == 'available') {
                                // check if this available timeslot fits in requested time range
                                let inRange = isInTimeRange(timeRange.start, timeRange.end, { hour, minute });
                                if (inRange) {
                                    let availableDay = new Date(year, month, day, hour, minute);
                                    availableDays.push(availableDay);
                                }
                            }
                        }
                    }
                }

                // if supplied just time (hour and minutes)
                if (!timeRange && (schedDay[requestedDate.getHours()]) && (schedDay[requestedDate.getHours()][requestedDate.getMinutes()])
                    && (schedDay[requestedDate.getHours()][requestedDate.getMinutes()] == 'available')) {
                    let availableDay = new Date(year, month, day, requestedDate.getHours(), requestedDate.getMinutes());
                    availableDays.push(availableDay);
                }
            }
        }
    }
    return availableDays;
}

function isIncrementOfThirty(time) {
    return (time.getMinutes() == 0 || time.getMinutes() == 30);
}

bot.dialog('askReason', [
    function (session) {
        builder.Prompts.text(session, 'What is the reason for the appointment?');
    },
    function (session, results) {
        session.userData.apptReason = results.response;
        session.endDialog();
    }
]);

bot.dialog('Help', function (session) {
    session.endDialog('Hi! Try asking me things like \'schedule an appointment\'');
}).triggerAction({
    matches: ['Hello', 'Help'],
    intentThreshold: .9
});

bot.dialog('Cancel', function (session) {
    session.endDialog('Appointment scheduling canceled.');
}).triggerAction({
    matches: 'Cancel',
    intentThreshold: .65
});

// Spell Check
if (process.env.IS_SPELL_CORRECTION_ENABLED === 'true') {
    bot.use({
        botbuilder: function (session, next) {
            spellService
                .getCorrectedText(session.message.text)
                .then(function (text) {
                    session.message.text = text;
                    next();
                })
                .catch(function (error) {
                    console.error(error);
                    next();
                });
        }
    });
}