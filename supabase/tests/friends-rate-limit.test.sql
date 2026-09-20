-- No wrapping transaction: each failed RPC really commits its attempt counter.
select no_plan();
insert into auth.users(id,email) values
 ('54000000-0000-0000-0000-000000000001','friend-rate-a@example.com'),
 ('54000000-0000-0000-0000-000000000002','friend-rate-b@example.com'),
 ('54000000-0000-0000-0000-000000000003','friend-rate-c@example.com');
set role authenticated;
set request.jwt.claims='{"sub":"54000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.social_save_profile('Rate A')$$,'rate-test pilot chooses a profile');
select is(public.social_request_friend(null)->>'status','unavailable','null lookup commits an unavailable result');
select is(public.social_request_friend(repeat('a',129))->>'status','unavailable','oversized lookup commits an unavailable result');
select is((select count(*)::int from generate_series(1,18) where
 public.social_request_friend('BADCODE')->>'status'='unavailable'),18,'all remaining attempts in the window commit');
reset role;
select is((select attempt_count from private.social_request_limits where user_id='54000000-0000-0000-0000-000000000001'),20,
 'failed lookups persisted their complete counter across transactions');
set role authenticated;
set request.jwt.claims='{"sub":"54000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok($$select public.social_save_profile('Rate B')$$,'another account is independent of the exhausted window');
do $$begin perform set_config('test.valid_code',public.social_get_state()->>'inviteCode',false); end$$;
set request.jwt.claims='{"sub":"54000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.social_request_friend(current_setting('test.valid_code'))->>'status','rate_limited','even a valid code cannot bypass the limit');
select is(public.social_request_friend('BADCODE')->>'status','rate_limited','repeated limited requests stay bounded');
reset role;
select is((select attempt_count from private.social_request_limits where user_id='54000000-0000-0000-0000-000000000001'),21,'counter saturates without overflow');
update private.social_request_limits set window_started_at=clock_timestamp()-interval '11 minutes'
 where user_id='54000000-0000-0000-0000-000000000001';
set role authenticated;
set request.jwt.claims='{"sub":"54000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.social_request_friend(current_setting('test.valid_code'))->>'status','sent','new window permits a legitimate request');
reset role;
select is((select attempt_count from private.social_request_limits where user_id='54000000-0000-0000-0000-000000000001'),1,'new window resets the bounded counter');

-- Both FK positions cascade, while unrelated accounts/relationships survive.
insert into public.social_profiles(user_id,display_name) values ('54000000-0000-0000-0000-000000000003','Rate C');
insert into private.social_relationships(user_low,user_high,requester_id,state) values
 ('54000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000003','54000000-0000-0000-0000-000000000003','accepted'),
 ('54000000-0000-0000-0000-000000000002','54000000-0000-0000-0000-000000000003','54000000-0000-0000-0000-000000000002','accepted');
insert into private.social_blocks(blocker_id,blocked_id) values
 ('54000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000003'),
 ('54000000-0000-0000-0000-000000000003','54000000-0000-0000-0000-000000000001');
delete from auth.users where id='54000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.social_profiles where user_id='54000000-0000-0000-0000-000000000001'),0,'account deletion removes chosen social identity');
select is((select count(*)::int from private.social_invites where user_id='54000000-0000-0000-0000-000000000001'),0,'account deletion removes private code');
select is((select count(*)::int from private.social_request_limits where user_id='54000000-0000-0000-0000-000000000001'),0,'account deletion removes lookup quota');
select is((select count(*)::int from private.social_relationships where '54000000-0000-0000-0000-000000000001' in (user_low,user_high)),0,'account deletion removes both relationship directions');
select is((select count(*)::int from private.social_blocks where '54000000-0000-0000-0000-000000000001' in (blocker_id,blocked_id)),0,'account deletion removes both block directions');
select is((select count(*)::int from private.social_relationships where user_low='54000000-0000-0000-0000-000000000002' and user_high='54000000-0000-0000-0000-000000000003'),1,'unrelated accepted friendship survives account deletion');
delete from auth.users where id in ('54000000-0000-0000-0000-000000000002','54000000-0000-0000-0000-000000000003');
select * from finish();
