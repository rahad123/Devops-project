import { IsString, IsDateString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SchedulePointDto {
  @ApiProperty({ example: 'Sylhet Kadamtoli Bus Terminal' })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiProperty({ example: '2026-09-17T00:00:00.000Z' })
  @IsDateString()
  time: string;
}
